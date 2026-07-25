"""
program_chip.py — NTAG 424 DNA provisioning for the Lajtner Inventor Series.

Transport: ACR1552 via PC/SC (pyscard). nfcpy does NOT support this reader, so we
talk to the tag with raw ISO-7816 APDUs.

────────────────────────────────────────────────────────────────────────────
STAGE 1 (this file) — SAFE, fully reversible. No key change, no SUN, no lock.
    * read the chip UID
    * write an NDEF message:  URL  +  serial text
    * read it back and verify
Purpose: prove the write path on ONE chip and let you tap it with a phone.

STAGE 2 (next, after stage 1 works on real hardware) — the "secret code":
    * EV2 authenticate with the default key
    * change the app key to your NTAG_KEY (from env)
    * enable SDM/SUN so every tap yields  ?picc=<UID>&cmac=<CMAC>
  (kept separate on purpose: key change is irreversible if mishandled, so we
   only do it once stage 1 is confirmed good.)
────────────────────────────────────────────────────────────────────────────

Usage:
    python program_chip.py 1                 # write serial "No. 01 of 50"
    python program_chip.py 1 --url-only      # write only the URL (no serial text)
    python program_chip.py 1 --read          # just read current NDEF, write nothing

Serial format (confirmed):  Lajtner Inventor Series — No. 01 of 50
    (em-dash U+2014; dot only after "No."; no dot at the end)
"""
import sys

VERIFY_URL_BASE = "https://wheelttt.xyz/verify"      # confirmed
SERIAL_FMT      = "Lajtner Inventor Series \u2014 No. {n:02d} of 50"
TOTAL           = 50

# ── NDEF file (Type 4 Tag) constants ────────────────────────────────────────
NDEF_AID   = [0xD2, 0x76, 0x00, 0x00, 0x85, 0x01, 0x01]   # NDEF application
NDEF_FID   = [0xE1, 0x04]                                  # NDEF file id
CC_FID     = [0xE1, 0x03]

# ── low-level PC/SC helpers ─────────────────────────────────────────────────
def get_reader():
    from smartcard.System import readers
    rs = [r for r in readers() if "PICC" in str(r)] or readers()
    if not rs:
        raise SystemExit("No PC/SC reader found. Is the ACR1552 plugged in?")
    return rs[0]

def connect():
    conn = get_reader().createConnection()
    conn.connect()
    return conn

def transmit(conn, apdu, label=""):
    data, sw1, sw2 = conn.transmit(apdu)
    sw = (sw1 << 8) | sw2
    if sw != 0x9000:
        raise RuntimeError(f"APDU failed ({label}): SW={sw1:02X}{sw2:02X}")
    return data

def hexs(b):
    from smartcard.util import toHexString
    return toHexString(list(b)).replace(" ", "")

def get_uid(conn):
    from smartcard.util import toHexString
    data, sw1, sw2 = conn.transmit([0xFF, 0xCA, 0x00, 0x00, 0x00])
    if (sw1, sw2) != (0x90, 0x00):
        raise RuntimeError("Could not read UID — chip on the antenna?")
    return toHexString(data).replace(" ", "")

# ── ISO Type-4 select / read / write ────────────────────────────────────────
def select_by_name(conn, aid):
    transmit(conn, [0x00, 0xA4, 0x04, 0x00, len(aid)] + aid + [0x00], "select AID")

def select_file(conn, fid):
    transmit(conn, [0x00, 0xA4, 0x00, 0x0C, len(fid)] + fid, "select file")

def read_binary(conn, offset, length):
    return bytes(transmit(conn, [0x00, 0xB0, (offset >> 8) & 0xFF, offset & 0xFF, length],
                          "read binary"))

def update_binary(conn, offset, data):
    data = list(data)
    transmit(conn, [0x00, 0xD6, (offset >> 8) & 0xFF, offset & 0xFF, len(data)] + data,
             "update binary")

# ── NDEF message builder ────────────────────────────────────────────────────
def ndef_uri_record(url, last=False):
    # URI identifier code 0x00 = no abbreviation (keep full https:// explicit)
    payload = bytes([0x00]) + url.encode("utf-8")
    tnf_flags = 0xD1 if last else 0x91          # MB/ME/SR, TNF=well-known; ME set if last
    return bytes([tnf_flags, 0x01, len(payload)]) + b"U" + payload

def ndef_text_record(text, lang="en", first=False, last=True):
    body = bytes([len(lang)]) + lang.encode("ascii") + text.encode("utf-8")
    flags = 0x11
    if first: flags |= 0x80    # MB
    if last:  flags |= 0x40    # ME
    return bytes([flags, 0x01, len(body)]) + b"T" + body

def build_ndef(url, serial=None):
    if serial:
        rec = ndef_uri_record(url, last=False) + ndef_text_record(serial, first=False, last=True)
    else:
        rec = ndef_uri_record(url, last=True)
    return rec

def write_ndef(conn, message):
    # NDEF file layout: 2-byte NLEN, then the message
    select_by_name(conn, NDEF_AID)
    select_file(conn, NDEF_FID)
    nlen = len(message)
    # write NLEN=0 first (spec-safe), then message, then real NLEN
    update_binary(conn, 0, bytes([0x00, 0x00]))
    update_binary(conn, 2, message)
    update_binary(conn, 0, bytes([(nlen >> 8) & 0xFF, nlen & 0xFF]))

def read_ndef(conn):
    select_by_name(conn, NDEF_AID)
    select_file(conn, NDEF_FID)
    hdr = read_binary(conn, 0, 2)
    nlen = (hdr[0] << 8) | hdr[1]
    if nlen == 0:
        return b""
    return read_binary(conn, 2, min(nlen, 240))

# ── main ────────────────────────────────────────────────────────────────────
def main():
    args = sys.argv[1:]
    read_only = "--read" in args
    url_only  = "--url-only" in args
    nums = [a for a in args if a.isdigit()]
    n = int(nums[0]) if nums else 1
    if not (1 <= n <= TOTAL):
        raise SystemExit(f"Number must be 1..{TOTAL}")

    conn = connect()
    uid  = get_uid(conn)
    print(f"UID: {uid}")

    if read_only:
        cur = read_ndef(conn)
        print("Current NDEF (raw):", hexs(cur) if cur else "(empty)")
        try:
            print("Readable text     :", cur.decode("utf-8", "replace"))
        except Exception:
            pass
        return

    url    = f"{VERIFY_URL_BASE}?picc={uid}"          # stage 1: static UID in URL
    serial = None if url_only else SERIAL_FMT.format(n=n)
    print(f"URL   : {url}")
    if serial:
        print(f"Serial: {serial}")

    msg = build_ndef(url, serial)
    write_ndef(conn, msg)
    print(f"WROTE {len(msg)} bytes of NDEF.")

    # verify
    back = read_ndef(conn)
    ok = url.encode() in back and (serial is None or serial.encode() in back)
    print("VERIFY:", "PASS ✓ (tap the chip with a phone to see it)" if ok else "FAIL ✗")
    print(f"\nLog line →  {uid},{n:02d},\"{serial or ''}\"")

if __name__ == "__main__":
    main()
