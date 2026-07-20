"""
physics_db_check.py
===================
Checks that physics data lives in the DB (single source of truth) and can
trigger the bulk reprocess so every measurement gets LT/LJ written into
physics_json.

Usage (on the server or any machine that can reach them):

    # 1) Just check the DB state:
    python physics_db_check.py

    # 2) Check AND reprocess everything, then re-check:
    python physics_db_check.py --rerun

Env (same as the app):
    SUPABASE_URL, SUPABASE_KEY      — to read the DB directly
    API_BASE (default https://wheelttt.xyz) — for --rerun
    MASTER_TOKEN (default wt_master_2026)
"""
import os, sys, json

API_BASE     = os.environ.get("API_BASE", "http://localhost:8000")
MASTER_TOKEN = os.environ.get("MASTER_TOKEN", "wt_master_2026")


def _sb():
    try:
        from supabase import create_client
    except ImportError:
        print("pip install supabase")
        sys.exit(1)
    url = os.environ.get("SUPABASE_URL", "")
    key = os.environ.get("SUPABASE_KEY", "")
    if not url or not key:
        print("Set SUPABASE_URL and SUPABASE_KEY env vars (same as the app uses).")
        sys.exit(1)
    return create_client(url, key)


def check():
    sb = _sb()
    jobs = sb.table("wt_jobs").select("id").execute().data or []
    rows = sb.table("physics_results").select("job_id, physics_json").execute().data or []
    n_lt = n_lj = n_lr = bad_json = 0
    for r in rows:
        try:
            p = json.loads(r.get("physics_json") or "{}")
        except Exception:
            bad_json += 1
            continue
        if p.get("lajtner_time"):
            n_lt += 1
        if p.get("lajtner_jerk_deg"):
            n_lj += 1
        if (p.get("air") or {}).get("planck_freq"):
            n_lr += 1
    print(f"wt_jobs:               {len(jobs)}")
    print(f"physics_results rows:  {len(rows)}")
    print(f"  with LR (air):       {n_lr}")
    print(f"  with lajtner_time:   {n_lt}")
    print(f"  with lajtner_jerk:   {n_lj}")
    if bad_json:
        print(f"  BROKEN physics_json: {bad_json}")
    missing = len(jobs) - len(rows)
    if missing > 0:
        print(f"  jobs WITHOUT physics row: {missing}  → run with --rerun")
    if len(rows) and n_lt < len(rows):
        print(f"  rows without LT: {len(rows) - n_lt}"
              f"  (wrong-direction/short moves stay empty by design; others → --rerun)")


def rerun():
    import urllib.request
    url = f"{API_BASE}/admin/rerun-all-physics?token={MASTER_TOKEN}"
    print(f"POST {url}")
    req = urllib.request.Request(url, method="POST")
    with urllib.request.urlopen(req, timeout=1800) as r:
        print(r.read().decode())


if __name__ == "__main__":
    if "--rerun" in sys.argv:
        rerun()
        print("\n--- after reprocess ---")
    check()
