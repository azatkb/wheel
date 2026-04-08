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
        except Exception as e:
            log.error(f"[DB] finish_job: {e}")


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


def read_samples(job_id: str) -> list:
    """Read all samples for a job from CSV (fast, no Supabase roundtrip)."""
    csv_path = CSV_DIR / f"{job_id}.csv"
    if not csv_path.exists():
        return []
    rows = []
    try:
        with open(csv_path, "r", encoding="utf-8") as f:
            for row in csv.DictReader(f, delimiter=CSV_SEPARATOR):
                for k in ("timestamp_sec","rotation_deg","rotation_rad",
                          "cumulative_deg","cumulative_rad",
                          "angular_vel_dps","angular_vel_rps"):
                    if row.get(k) not in ("", "None", None):
                        row[k] = float(row[k])
                    else:
                        row[k] = None
                row["confidence_pct"] = int(row.get("confidence_pct") or 0)
                rows.append(row)
    except Exception as e:
        log.error(f"[CSV] read failed: {e}")
    return rows


def get_csv_path(job_id: str) -> Path:
    return CSV_DIR / f"{job_id}.csv"
