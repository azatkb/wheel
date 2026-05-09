"""
backfill_power.py
Пересчитывает p_peak_air и p_avg_air для всех записей в physics_results
где эти значения = 0 или NULL.
Запуск: python backfill_power.py
"""
import os, json
from supabase import create_client

from dotenv import load_dotenv; load_dotenv()

SUPABASE_URL   = os.getenv("SUPABASE_URL",   "https://eslyzmgvffoldhocjfvc.supabase.co")
SUPABASE_KEY   = os.getenv("SUPABASE_KEY",   "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImVzbHl6bWd2ZmZvbGRob2NqZnZjIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3NzM1NjQwMSwiZXhwIjoyMDkyOTMyNDAxfQ.NZIFVmFwld93rpFpw2TOTqatU0xPH-S_sRUYgjRBcvI")

sb = create_client(SUPABASE_URL, SUPABASE_KEY)

# 1. Получить все записи где p_peak_air = 0
resp = sb.table("physics_results")\
    .select("job_id, physics_json")\
    .eq("p_peak_air", 0)\
    .execute()

rows = resp.data or []
print(f"Records to backfill: {len(rows)}")

updated = 0
skipped = 0

for row in rows:
    job_id = row["job_id"]
    try:
        phys = json.loads(row.get("physics_json") or "{}")
        air = phys.get("air", {})
        p_peak = air.get("P_peak", 0) or 0
        p_avg  = air.get("P_avg",  0) or 0

        if p_peak == 0 and p_avg == 0:
            skipped += 1
            continue

        sb.table("physics_results")\
            .update({"p_peak_air": float(p_peak), "p_avg_air": float(p_avg)})\
            .eq("job_id", job_id)\
            .execute()

        updated += 1
        print(f"  Updated {job_id[:8]}...  P_peak={p_peak:.3e}  P_avg={p_avg:.3e}")

    except Exception as e:
        print(f"  ERROR {job_id[:8]}: {e}")

print(f"\nDone! Updated: {updated}, Skipped (no data): {skipped}")