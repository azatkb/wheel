"""
backfill_rotation.py
Fixes cumulative_deg = 0 in physics_results by reading phi_total from physics_json.
Run: python backfill_rotation.py
"""
import os, json, math
from supabase import create_client
from dotenv import load_dotenv
load_dotenv()

sb = create_client(os.environ["SUPABASE_URL"], os.environ["SUPABASE_KEY"])

resp = sb.table("physics_results").select("job_id,cumulative_deg,physics_json").execute()
rows = resp.data or []
print(f"Total records: {len(rows)}")

fixed = 0
for row in rows:
    if (row.get("cumulative_deg") or 0) != 0:
        continue  # already has value
    try:
        phys = json.loads(row.get("physics_json") or "{}")
        phi = phys.get("ideal", {}).get("phi_total") or \
              phys.get("air",   {}).get("phi_total") or 0
        deg = abs(phi * 180 / math.pi)
        if deg < 0.001:
            continue
        sb.table("physics_results")\
          .update({"cumulative_deg": round(deg, 4)})\
          .eq("job_id", row["job_id"])\
          .execute()
        print(f"  Fixed {row['job_id'][:8]}... → {deg:.2f}°")
        fixed += 1
    except Exception as e:
        print(f"  ERROR {row['job_id'][:8]}: {e}")

print(f"\nDone! Fixed {fixed} records.")
