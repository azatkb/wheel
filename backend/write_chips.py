"""
write_chips.py  —  write Lajtner chips, the easy way.

Each chip gets TWO things:

  1) The secret SUN code — a code that CHANGES ON EVERY TAP and cannot be copied
     (NTAG 424 DNA "SUN"). This is what proves a chip is genuine.

  2) Its serial — e.g. "Lajtner Pioneer Series #01 of 50". The serial is saved on
     our server next to the chip, so tapping the chip always shows the right one.

You do NOT have to write all 50 per series — write as many as you like (4-5 is fine).

LEARNING MODE: this tool keeps the default key, so every chip stays FULLY
RE-WRITABLE — you can practise and re-write the same chips as often as you like.
It never writes the permanent key, so nothing here can be locked or ruined.

HOW TO USE
  1) Plug in the ACR1552 reader.
  2) Run:   python write_chips.py
  3) Pick a series, say how many, and place each chip on the reader when asked.
  4) After each one you can tap it with your phone to check it opens the verify page.

Advanced (skip the menu):
  python write_chips.py --pioneer 1 5     # writes Pioneer #01..#05
  python write_chips.py --founder 1 4     # writes Founder No. 01..04
"""
import sys, os, subprocess

# Windows consoles choke on the em-dash etc. — force UTF-8.
try:
    sys.stdout.reconfigure(encoding="utf-8")
    sys.stderr.reconfigure(encoding="utf-8")
except Exception:
    pass

HERE = os.path.dirname(os.path.abspath(__file__))
PROG = os.path.join(HERE, "program_chip_sun.py")   # does the actual chip writing

# menu key -> (series id used by program_chip_sun.py, friendly label)
SERIES = {
    "1": ("pioneer",  "Pioneer Series"),
    "2": ("spectrum", "Spectrum Series"),
    "3": ("founder",  "Founder Series"),
    "4": ("core",     "Core Series"),
}


def write_one(series, n):
    """Write a single chip (SUN secret + serial) and register it on the server."""
    print(f"\n--- writing {series} #{n:02d} ---")
    r = subprocess.run([sys.executable, PROG, str(n), f"--{series}", "--sdm"])
    return r.returncode == 0


def run_series(series, start, count):
    ok = 0
    for n in range(start, start + count):
        ans = input(f"\nPlace the chip for #{n:02d} on the reader, then press Enter "
                    f"(s = skip, q = quit): ").strip().lower()
        if ans == "q":
            break
        if ans == "s":
            continue
        if write_one(series, n):
            ok += 1
            print(f"  OK - #{n:02d} written. Tap it with a phone to test.")
        else:
            print(f"  FAILED on #{n:02d}. Make sure the chip is flat on the reader.")
            if input("  Retry this one? (y/n): ").strip().lower() == "y":
                if write_one(series, n):
                    ok += 1
                    print(f"  OK - #{n:02d} written.")
    return ok


def menu():
    print(__doc__)
    while True:
        print("\nWhich series do you want to write?")
        for k, (s, label) in SERIES.items():
            print(f"  {k}) {label}")
        print("  q) quit")
        choice = input("Choose 1-4 (or q): ").strip().lower()
        if choice == "q":
            break
        if choice not in SERIES:
            print("Please type 1, 2, 3, 4 or q.")
            continue
        series, label = SERIES[choice]
        try:
            start = int((input("Start from which number? (default 1): ").strip() or "1"))
            count = int((input(f"How many {label} chips to write? (e.g. 5): ").strip() or "0"))
        except ValueError:
            print("Please enter whole numbers.")
            continue
        if count <= 0:
            print("Nothing to write.")
            continue
        ok = run_series(series, start, count)
        print(f"\n=== {label}: wrote {ok} chip(s). ===")
    print("\nDone. You can run this again any time to write more.")


def main():
    args = sys.argv[1:]
    # quick mode: --<series> <start> <count>
    for _k, (s, _label) in SERIES.items():
        if f"--{s}" in args:
            nums = [int(a) for a in args if a.isdigit()]
            start = nums[0] if len(nums) >= 1 else 1
            count = nums[1] if len(nums) >= 2 else 1
            run_series(s, start, count)
            return
    menu()


if __name__ == "__main__":
    main()
