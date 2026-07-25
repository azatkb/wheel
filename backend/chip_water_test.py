"""
chip_water_test.py — quick read tester for the NTAG 424 DNA water-resistance trials.

Place a chip on the ACR1552 PICC (contactless) antenna and run:

    python chip_water_test.py            # single read
    python chip_water_test.py --watch    # keep reading every 1s (live monitor)

It prints the UID + PASS/FAIL so you can log each step of the water test.

NOTE ON READING UNDER WATER:
  NFC (13.56 MHz) is heavily attenuated by water. A chip submerged directly on
  the reader will often NOT read — that is expected physics, NOT a broken chip.
  The meaningful tests are #2 and #3: does it still read AFTER soaking / drying.
"""
import sys, time

def read_once():
    from smartcard.System import readers
    from smartcard.util import toHexString
    rs = [r for r in readers() if "PICC" in str(r)] or readers()
    if not rs:
        return None, "no reader"
    try:
        conn = rs[0].createConnection()
        conn.connect()
        data, sw1, sw2 = conn.transmit([0xFF, 0xCA, 0x00, 0x00, 0x00])  # GET UID
        if (sw1, sw2) == (0x90, 0x00):
            return toHexString(data).replace(" ", ""), "ok"
        return None, f"reader returned {sw1:02X}{sw2:02X}"
    except Exception as e:
        return None, "no card / not readable"

def line(uid, status):
    ts = time.strftime("%H:%M:%S")
    if uid:
        return f"[{ts}]  PASS  UID={uid}"
    return f"[{ts}]  ----  ({status})"

if __name__ == "__main__":
    watch = "--watch" in sys.argv
    if not watch:
        uid, st = read_once()
        print(line(uid, st))
    else:
        print("Live monitor — Ctrl+C to stop.\n")
        try:
            while True:
                uid, st = read_once()
                print(line(uid, st))
                time.sleep(1)
        except KeyboardInterrupt:
            print("\nstopped.")
