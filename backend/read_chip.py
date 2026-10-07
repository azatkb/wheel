"""
read_chip.py — read a chip WITHOUT changing anything (safe, read-only).

Shows the UID and the NDEF text (the URL / serial written on it), so you can
confirm what a chip currently holds.

Usage:
    python read_chip.py
"""
import sys
try:
    sys.stdout.reconfigure(encoding='utf-8')
except Exception: pass

NDEF_AID = [0xD2, 0x76, 0x00, 0x00, 0x85, 0x01, 0x01]
NDEF_FID = [0xE1, 0x04]

def _conn():
    from smartcard.System import readers
    rs = [r for r in readers() if "PICC" in str(r)] or readers()
    if not rs:
        raise SystemExit("No PC/SC reader — is the ACR1552 plugged in?")
    c = rs[0].createConnection(); c.connect(); return c

def _tx(conn, apdu, label):
    d, s1, s2 = conn.transmit(apdu)
    if (s1, s2) != (0x90, 0x00):
        raise RuntimeError(f"{label}: SW={s1:02X}{s2:02X}")
    return d

def main():
    from smartcard.util import toHexString
    conn = _conn()
    # UID
    d, s1, s2 = conn.transmit([0xFF, 0xCA, 0x00, 0x00, 0x00])
    if (s1, s2) != (0x90, 0x00):
        raise SystemExit("UID read failed — chip on the antenna?")
    uid = toHexString(d).replace(" ", "")
    print(f"UID   : {uid}")

    # NDEF
    _tx(conn, [0x00, 0xA4, 0x04, 0x00, len(NDEF_AID)] + NDEF_AID + [0x00], "select AID")
    _tx(conn, [0x00, 0xA4, 0x00, 0x0C, len(NDEF_FID)] + NDEF_FID, "select NDEF file")
    # read NLEN (first 2 bytes)
    hdr = _tx(conn, [0x00, 0xB0, 0x00, 0x00, 0x02], "read nlen")
    nlen = (hdr[0] << 8) | hdr[1]
    if nlen == 0:
        print("NDEF  : (empty)")
        return
    # read the NDEF body
    body = []
    off = 2
    remaining = nlen
    while remaining > 0:
        chunk = min(200, remaining)
        d = _tx(conn, [0x00, 0xB0, (off >> 8) & 0xFF, off & 0xFF, chunk], "read body")
        body += list(d); off += chunk; remaining -= chunk
    raw = bytes(body)
    # extract the URL/text (strip NDEF record header)
    try:
        txt = raw.decode("ascii", errors="replace")
    except Exception:
        txt = str(raw)
    # find http... if present
    i = txt.find("http")
    print(f"NDEF  : {txt[i:] if i >= 0 else txt}")

if __name__ == "__main__":
    main()
