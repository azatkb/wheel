"""
program_founder50.py — program the first 50 Founder units (Step B only).

Everything here is REVERSIBLE: it writes NDEF + enables SUN but KEEPS the default
key (00..00). No key change, no locking — nothing irreversible.

Programs Founder No. 01 .. No. 50 one at a time, pausing between chips, and logs
each UID + serial at the end so you can register them in the DB.

Usage:
    python program_founder50.py --list          # print the plan only
    python program_founder50.py                 # program all 50 (01..50)
    python program_founder50.py --from 1 --to 10  # program a sub-range (e.g. 01..10)
"""
import sys, subprocess
try:
    sys.stdout.reconfigure(encoding='utf-8'); sys.stderr.reconfigure(encoding='utf-8')
except Exception: pass

def serial(n): return f"Lajtner Founder Series No. {n:02d} of 50"

def arg(name, default):
    if name in sys.argv:
        i = sys.argv.index(name)
        if i + 1 < len(sys.argv):
            return int(sys.argv[i + 1])
    return default

def main():
    start = arg("--from", 1)
    end   = arg("--to", 50)
    nums  = list(range(start, end + 1))

    if "--list" in sys.argv:
        print(f"Founder batch plan: No. {start:02d} .. No. {end:02d}  ({len(nums)} chips)")
        for n in nums: print(f"  {serial(n)}")
        return

    print(f"=== FOUNDER 01–50 — Step B only (default key, fully reversible) ===")
    print(f"Programming No. {start:02d}..No. {end:02d}  ({len(nums)} chips)\n")
    log = []
    for i, n in enumerate(nums, 1):
        print(f"\n--- {i}/{len(nums)}: {serial(n)} ---")
        input("Place this chip on the reader, then press Enter (or Ctrl+C to stop)… ")
        cmd = [sys.executable, "program_chip_sun.py", str(n), "--founder", "--sdm"]
        r = subprocess.run(cmd, capture_output=True, text=True)
        print(r.stdout)
        if r.returncode != 0:
            print("!! ERROR:", r.stderr)
            if input("Continue with the next chip? [y/N] ").lower() != "y":
                break
            continue
        uid = ""
        for line in r.stdout.splitlines():
            if line.strip().startswith("UID"):
                uid = line.split(":")[-1].strip()
        log.append((n, uid))
        print(f"✓ done — UID={uid}")

    print("\n=== DONE — register these in the DB ===")
    for n, uid in log:
        print(f'  UID={uid}   serial="{serial(n)}"')
    print("\nAll chips still use the DEFAULT key (reversible). "
          "Tap each with a phone to verify against the server (NTAG_KEY=00..00).")

if __name__ == "__main__":
    main()
