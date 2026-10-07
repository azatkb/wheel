"""
program_batch.py — program the NEW batch of chips one by one.

The first 50 (Founder/Inventor) are already programmed & paid — NOT touched here.
This does the 7 new chips: Founder 02/03, Alpha 002/003, Core x2, Pioneer 01.

For each chip it runs Step B (--sdm, default key, reversible), waits for you to
place the next chip, and logs UID + serial so you can register them in the DB.

Run Step C (--change-key) separately per chip only AFTER you've tap-verified them.

Usage:
    python program_batch.py            # program all 7 (Step B), pausing between each
    python program_batch.py --list     # just print the plan, program nothing
"""
import sys, subprocess

# (series, number) — number ignored for core
BATCH = [
    ("founder", 2),
    ("founder", 3),
    ("alpha",   2),
    ("alpha",   3),
    ("core",    0),
    ("core",    0),
    ("pioneer", 1),
]

def label(series, n):
    if series == "core":            return "Lajtner Core Series (no number)"
    if series == "pioneer":         return f"Lajtner Pioneer #{n:02d} of 50"
    if series == "alpha":           return f"Lajtner Alpha Series No. {n:03d} of 500"
    return f"Lajtner Founder Series No. {n:02d} of 50"

def main():
    if "--list" in sys.argv:
        print("Batch plan (7 new chips):")
        for i, (s, n) in enumerate(BATCH, 1):
            print(f"  {i}. {label(s, n)}")
        print("\nThe first 50 (already paid) are NOT included.")
        return

    print("=== NEW BATCH — 7 chips (Step B, default key, reversible) ===")
    print("The first 50 paid chips are NOT touched.\n")
    log = []
    for i, (series, n) in enumerate(BATCH, 1):
        print(f"\n--- Chip {i}/{len(BATCH)}: {label(series, n)} ---")
        input("Place this chip on the reader, then press Enter… ")
        cmd = [sys.executable, "program_chip_sun.py"]
        if series != "core":
            cmd.append(str(n))
        cmd += [f"--{series}", "--sdm"]
        r = subprocess.run(cmd, capture_output=True, text=True)
        print(r.stdout)
        if r.returncode != 0:
            print("!! ERROR:", r.stderr)
            if input("Continue with the next chip anyway? [y/N] ").lower() != "y":
                break
            continue
        # capture UID line for the log
        uid = ""
        for line in r.stdout.splitlines():
            if line.strip().startswith("UID"):
                uid = line.split(":")[-1].strip()
        log.append((series, n, uid, label(series, n)))
        print(f"✓ done — UID={uid}")

    print("\n=== BATCH DONE — register these in the DB ===")
    for series, n, uid, lab in log:
        print(f'  UID={uid}   serial="{lab}"')
    print("\nNext: tap each chip with a phone to verify, then run "
          "program_chip_sun.py ... --change-key per chip to set your real key.")

if __name__ == "__main__":
    main()
