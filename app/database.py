"""
database.py
===========
All persistence:  Supabase (PostgreSQL)  +  CSV file  (written simultaneously).

Supabase SQL to run once in the SQL Editor:
───────────────────────────────────────────
CREATE TABLE wt_jobs (
    id              TEXT        PRIMARY KEY,   -- job UUID
    user_email      TEXT,
    source_type     TEXT,                      -- 'upload' | 'stream'
    direction       TEXT,                      -- 'cw','ccw','cw+ccw','ccw+cw','auto'
    medium          TEXT,                      -- 'air' | 'water'
    hand_visible    BOOLEAN     DEFAULT FALSE,
    info_level      TEXT        DEFAULT 'basic',
    status          TEXT        DEFAULT 'queued',
    sample_count    INTEGER     DEFAULT 0,
    duration_sec    FLOAT,
    created_at      TIMESTAMPTZ DEFAULT NOW(),
    finished_at     TIMESTAMPTZ
);

CREATE TABLE wt_samples (
    id              BIGSERIAL   PRIMARY KEY,
    job_id          TEXT        NOT NULL REFERENCES wt_jobs(id),
    timestamp_sec   FLOAT       NOT NULL,      -- seconds from start
    rotation_deg    FLOAT,                     -- current angle in degrees (0° = start)
    rotation_rad    FLOAT,                     -- same in radians
    cumulative_deg  FLOAT       NOT NULL,      -- total rotation, downward = positive
    cumulative_rad  FLOAT       NOT NULL,
    angular_vel_dps FLOAT,                     -- angular velocity deg/s
    angular_vel_rps FLOAT,                     -- angular velocity rad/s
    confidence_pct  INTEGER     NOT NULL,      -- 0-100
    source          TEXT,                      -- 'YELLOW' | 'RED' | null
    created_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX ON wt_samples (job_id);
CREATE INDEX ON wt_samples (job_id, timestamp_sec);
"""

import csv
import json
import logging
import math
from pathlib import Path
from typing import Optional

from app.config import SUPABASE_URL, SUPABASE_KEY, TABLE_JOBS, TABLE_SAMPLES, CSV_SEPARATOR, CSV_DIR

log = logging.getLogger(__name__)

# ── Supabase lazy client ───────────────────────────────────────────────────
_client = None

def _sb():
    """Return shared Supabase client, connecting on first call."""
    global _client
    if _client is None:
        try:
            from supabase import create_client
            _client = create_client(SUPABASE_URL, SUPABASE_KEY)
            log.info("[DB] Supabase connected")
        except Exception as e:
            log.error(f"[DB] Supabase connection failed: {e}")
    return _client


# ── Job record ─────────────────────────────────────────────────────────────

def create_job(job_id: str, user_email: str, source_type: str,
               direction: str, medium: str, hand_visible: bool,
               info_level: str) -> bool:
    """Insert one row into wt_jobs when a new session starts."""
    row = {
        "id":           job_id,
        "user_email":   user_email or "",
        "source_type":  source_type,
        "direction":    direction,
        "medium":       medium,
        "hand_visible": hand_visible,
        "info_level":   info_level,
        "status":       "queued",
    }
    # Supabase
    sb = _sb()
    if sb:
        try:
            sb.table(TABLE_JOBS).insert(row).execute()
        except Exception as e:
            log.error(f"[DB] create_job Supabase: {e}")
    return True


def finish_job(job_id: str, sample_count: int, duration_sec: float) -> None:
    """Mark job as done with final stats."""
    sb = _sb()
    if sb:
        try:
            from datetime import datetime, timezone
            sb.table(TABLE_JOBS).update({
                "status":       "done",
                "sample_count": sample_count,
                "duration_sec": round(duration_sec, 2),
                "finished_at":  datetime.now(timezone.utc).isoformat(),
            }).eq("id", job_id).execute()
            log.info(f"[DB] finish_job done: {job_id}")
        except Exception as e:
            log.error(f"[DB] finish_job FAILED: {e}", exc_info=True)


def get_all_jobs(email_filter: str = "", limit: int = 200) -> list:
    """Return all jobs from Supabase, newest first."""
    sb = _sb()
    if not sb:
        return []
    try:
        q = sb.table(TABLE_JOBS).select(
            "id,user_email,source_type,medium,direction,status,"
            "sample_count,duration_sec,created_at,finished_at"
        ).order("created_at", desc=True).limit(limit)
        if email_filter:
            q = q.ilike("user_email", f"%{email_filter}%")
        resp = q.execute()
        return resp.data or []
    except Exception as e:
        log.warning(f"[DB] get_all_jobs: {e}")
        return []


# ── Sample helpers ─────────────────────────────────────────────────────────

CSV_FIELDS = [
    "job_id", "timestamp_sec",
    "rotation_deg", "rotation_rad",
    "cumulative_deg", "cumulative_rad",
    "angular_vel_dps", "angular_vel_rps",
    "confidence_pct", "source",
]


def make_sample(job_id: str, timestamp_sec: float,
                rotation_deg: Optional[float], cumulative_deg: float,
                angular_vel_dps: float, confidence_pct: int,
                source: Optional[str]) -> dict:
    """Build a sample dict with both degree and radian fields."""
    rotation_rad    = math.radians(rotation_deg)    if rotation_deg    is not None else None
    cumulative_rad  = math.radians(cumulative_deg)
    angular_vel_rps = math.radians(angular_vel_dps) if angular_vel_dps is not None else None

    return {
        "job_id":           job_id,
        "timestamp_sec":    round(timestamp_sec, 3),
        "rotation_deg":     round(rotation_deg,    2) if rotation_deg    is not None else None,
        "rotation_rad":     round(rotation_rad,    5) if rotation_rad    is not None else None,
        "cumulative_deg":   round(cumulative_deg,  2),
        "cumulative_rad":   round(cumulative_rad,  5),
        "angular_vel_dps":  round(angular_vel_dps, 2) if angular_vel_dps is not None else None,
        "angular_vel_rps":  round(angular_vel_rps, 5) if angular_vel_rps is not None else None,
        "confidence_pct":   confidence_pct,
        "source":           source,
    }


def persist_samples(job_id: str, samples: list) -> None:
    """Write batch of samples to Supabase AND CSV simultaneously."""
    if not samples:
        return

    # ── Supabase ──────────────────────────────────────────────────────
    sb = _sb()
    if sb:
        try:
            sb.table(TABLE_SAMPLES).insert(samples).execute()
            log.debug(f"[DB] Supabase: {len(samples)} rows → {TABLE_SAMPLES}")
        except Exception as e:
            log.error(f"[DB] Supabase insert failed: {e}")

    # ── CSV ───────────────────────────────────────────────────────────
    csv_path   = CSV_DIR / f"{job_id}.csv"
    file_exists = csv_path.exists()
    try:
        with open(csv_path, "a", newline="", encoding="utf-8") as f:
            w = csv.DictWriter(f, fieldnames=CSV_FIELDS,
                               delimiter=CSV_SEPARATOR, extrasaction="ignore")
            if not file_exists:
                w.writeheader()
            w.writerows(samples)
    except Exception as e:
        log.error(f"[CSV] write failed: {e}")


def _parse_sample_row(row: dict) -> dict:
    for k in ("timestamp_sec","rotation_deg","rotation_rad",
              "cumulative_deg","cumulative_rad",
              "angular_vel_dps","angular_vel_rps"):
        if row.get(k) not in ("", "None", None):
            row[k] = float(row[k])
        else:
            row[k] = None
    row["confidence_pct"] = int(row.get("confidence_pct") or 0)
    return row

def read_samples(job_id: str) -> list:
    """Read samples: CSV first, fallback to Supabase. Always sorted by timestamp."""
    csv_path = CSV_DIR / f"{job_id}.csv"
    if csv_path.exists():
        rows = []
        try:
            with open(csv_path, "r", encoding="utf-8") as f:
                for row in csv.DictReader(f, delimiter=CSV_SEPARATOR):
                    rows.append(_parse_sample_row(row))
            if rows:
                rows.sort(key=lambda r: float(r.get("timestamp_sec") or 0))
                return rows
        except Exception as e:
            log.error(f"[CSV] read failed: {e}")
    # Fallback: read from Supabase
    try:
        sb = _sb()
        if sb:
            resp = (sb.table(TABLE_SAMPLES)
                    .select("job_id,timestamp_sec,rotation_deg,rotation_rad,"
                            "cumulative_deg,cumulative_rad,"
                            "angular_vel_dps,angular_vel_rps,"
                            "confidence_pct,source")
                    .eq("job_id", job_id)
                    .order("timestamp_sec")
                    .execute())
            if resp.data:
                log.info(f"[DB] read {len(resp.data)} samples from Supabase: {job_id}")
                return resp.data
    except Exception as e:
        log.error(f"[DB] read_samples Supabase: {e}")
    return []


def get_csv_path(job_id: str) -> Path:
    return CSV_DIR / f"{job_id}.csv"

def get_physics_from_db(job_id: str) -> dict:
    """Return physics result for a job from Supabase."""
    try:
        sb = _sb()
        if sb is None:
            return {}
        resp = (sb.table("physics_results")
                .select("physics_json,t_lajtner,a_lajtner,cumulative_deg,w_total_air,f_max_air,omega_max")
                .eq("job_id", job_id)
                .limit(1)
                .execute())
        if not resp.data:
            return {}
        row = resp.data[0]
        phys = json.loads(row.get("physics_json") or "{}")
        return {
            "result": phys,
            "t_lajtner": row.get("t_lajtner"),
            "a_lajtner": row.get("a_lajtner"),
        }
    except Exception as e:
        log.warning(f"[DB] get_physics_from_db: {e}")
        return {}


def get_group_averages() -> dict:
    """Return average physics values across ALL users for group ranking."""
    try:
        sb = _sb()
        if not sb:
            return {}
        resp = (sb.table("physics_results")
                .select("cumulative_deg,w_total_air,f_max_air,omega_max")
                .limit(1000)
                .execute())
        if not resp.data:
            return {}
        rows = resp.data
        def avg(key):
            vals = [float(r[key]) for r in rows if r.get(key) is not None]
            return sum(vals)/len(vals) if vals else 0.0
        return {
            "cumulative_deg": avg("cumulative_deg"),
            "W_total_air":    avg("w_total_air"),
            "F_max_air":      avg("f_max_air"),
            "omega_max":      avg("omega_max"),
            "count":          len(rows),
        }
    except Exception as e:
        log.warning(f"[DB] get_group_averages: {e}")
        return {}


def get_user_history(email: str) -> list:
    """
    Return list of past physics results for a user.
    Each item: {"cumulative_deg": float, "w_total_air": float, "f_max_air": float}
    Returns empty list if user has no history or DB unavailable.
    """
    try:
        sb = _sb()
        if sb is None:
            return []
        resp = (sb.table("physics_results")
                .select("cumulative_deg,w_total_air,f_max_air")
                .eq("email", email)
                .order("created_at", desc=True)
                .limit(50)
                .execute())
        return resp.data or []
    except Exception as e:
        log.warning(f"[DB] get_user_history failed: {e}")
        return []
 
 

def get_master_data(limit: int = 1000) -> list:
    """Master user: read ALL physics results from ALL users."""
    try:
        sb = _sb()
        if sb is None: return []
        resp = (sb.table("physics_results")
                .select("job_id,email,medium,cumulative_deg,w_total_air,w_total_water,"
                        "f_max_air,omega_max,t_lajtner,a_lajtner,cw_deg,ccw_deg,"
                        "cw_ccw_deg,ccw_cw_deg,physics_json,created_at")
                .order("created_at", desc=True)
                .limit(limit)
                .execute())
        return resp.data or []
    except Exception as e:
        log.warning(f"[DB] get_master_data: {e}")
        return []


def get_user_bar_data(email: str) -> dict:
    """
    Return data for bar chart:
    - last 2 measurements for this user
    - user average
    - group average
    """
    try:
        sb = _sb()
        if sb is None: return {}

        # Last 2 user measurements
        resp = (sb.table("physics_results")
                .select("job_id,cumulative_deg,w_total_air,f_max_air,omega_max,created_at")
                .eq("email", email)
                .order("created_at", desc=True)
                .limit(2)
                .execute())
        last2 = resp.data or []

        # User average (all measurements)
        resp_all = (sb.table("physics_results")
                   .select("cumulative_deg,w_total_air,f_max_air,omega_max")
                   .eq("email", email)
                   .execute())
        user_rows = resp_all.data or []

        def avg(rows, key):
            vals = [float(r[key]) for r in rows if r.get(key) is not None]
            return round(sum(vals)/len(vals), 3) if vals else 0.0

        user_avg = {
            "cumulative_deg": avg(user_rows, "cumulative_deg"),
            "w_total_air":    avg(user_rows, "w_total_air"),
            "f_max_air":      avg(user_rows, "f_max_air"),
            "omega_max":      avg(user_rows, "omega_max"),
            "count":          len(user_rows),
        }

        # Group average (all users)
        group = get_group_averages()

        return {
            "last2":     last2,
            "user_avg":  user_avg,
            "group_avg": group,
        }
    except Exception as e:
        log.warning(f"[DB] get_user_bar_data: {e}")
        return {}


def export_to_master_csv(out_path: str) -> int:
    """Export all physics_results to a master CSV for Excel import."""
    import csv as csv_mod
    rows = get_master_data(limit=10000)
    if not rows: return 0
    try:
        fieldnames = list(rows[0].keys())
        with open(out_path, "w", newline="", encoding="utf-8-sig") as f:
            writer = csv_mod.DictWriter(f, fieldnames=fieldnames, delimiter=";")
            writer.writeheader()
            for row in rows:
                writer.writerow(row)
        log.info(f"[DB] Master CSV exported: {out_path} ({len(rows)} rows)")
        return len(rows)
    except Exception as e:
        log.warning(f"[DB] export_to_master_csv: {e}")
        return 0

def save_physics_result(job_id: str, email: str, medium: str,
                        result: dict, csv_row: dict) -> None:
    """
    Save physics calculation results to Supabase + CSV file.
    csv_row is a flat dict from physics.build_csv_row().
    """
    # Save to CSV (semicolon separated, UTF-8)
    try:
        csv_path = CSV_DIR / f"{job_id}_physics.csv"
        with open(csv_path, "w", newline="", encoding="utf-8") as f:
            writer = csv.DictWriter(f, fieldnames=list(csv_row.keys()),
                                    delimiter=";")
            writer.writeheader()
            writer.writerow(csv_row)
        log.info(f"[DB] Physics CSV saved: {csv_path}")
    except Exception as e:
        log.warning(f"[DB] Physics CSV write failed: {e}")
 
    # Save to Supabase
    try:
        sb = _sb()
        if sb is None:
            return
 
        case = result.get("air", {})  # default to air case
        # Direction summation: 4 columns (absolute values, deg)
        # cw_deg, ccw_deg, cw_ccw_deg (cw+ccw sum), ccw_cw_deg (ccw+cw sum)
        all_phases = result.get("all_phases", [])
        cw_total  = sum(abs(p.get("phi_total_deg", 0)) for p in all_phases if p.get("direction") == "CW")
        ccw_total = sum(abs(p.get("phi_total_deg", 0)) for p in all_phases if p.get("direction") == "CCW")
        record = {
            "job_id":        job_id,
            "email":         email,
            "medium":        medium,
            "cumulative_deg": abs(float(csv_row.get("phi_total_rad_rad", 0)) * 180 / 3.14159),
            "w_total_air":   float(result.get("air",  {}).get("W_total", 0)),
            "w_total_water": float(result.get("water",{}).get("W_total", 0)),
            "f_max_air":     float(result.get("air",  {}).get("F_max",   0)),
            "omega_max":     float(result.get("kinematics",{}).get("omega_max", 0)),
            "t_lajtner":     float(result.get("t_lajtner", 0)),
            "a_lajtner":     float(result.get("a_lajtner", 0)),
            "cw_deg":        round(cw_total, 2),
            "ccw_deg":       round(ccw_total, 2),
            "cw_ccw_deg":    round(cw_total + ccw_total, 2),
            "ccw_cw_deg":    round(ccw_total + cw_total, 2),
            "physics_json":  json.dumps({
                "ideal": result.get("ideal"),
                "air":   result.get("air"),
                "water": result.get("water"),
                "all_phases": all_phases,
            }),
        }
        sb.table("physics_results").insert(record).execute()
        log.info(f"[DB] Physics saved to Supabase: {job_id}")
    except Exception as e:
        log.warning(f"[DB] Physics Supabase save failed: {e}")