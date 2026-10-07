"""
program_chip_sun.py - NTAG 424 DNA · STAGE 2 (SUN / "secret code").

Transport: ACR1552 via PC/SC (pyscard). SUN crypto via pylibsdm bridged to pyscard.

Stages (nothing irreversible until proven):
  Step A  (--dry-run, default)  build NDEF URL + offsets, print plan. No chip access.
  Step B  (--sdm)   auth default key, write NDEF, enable SDM/SUN. Key stays default (reversible).
  Step C  (--change-key)  change app key to NTAG_KEY (irreversible without the key). No locking.

Env:
    NTAG_KEY   32-hex batch key (Step C only). From env, never hardcoded.

Series:
    --pioneer   Lajtner Pioneer #NN of 50          (default)
    --founder   Lajtner Founder Series - No. NN of 50
    --alpha     Lajtner Alpha Series - No. NNN of 500
    --core      Lajtner Core Series                (no number)

Usage:
    python program_chip_sun.py 1 --founder                # Step A dry run
    python program_chip_sun.py 2 --founder --sdm          # Step B, Founder No. 02
    python program_chip_sun.py 3 --alpha  --sdm           # Step B, Alpha No. 003 of 500
    python program_chip_sun.py --core --sdm               # Step B, Core (no number)
    python program_chip_sun.py 1 --pioneer --change-key   # Step C
"""
import sys, os

# Windows consoles default to cp1251/cp866 and crash on em-dash (U+2014) etc.
# Force UTF-8 output so serials and arrows print fine.
try:
    sys.stdout.reconfigure(encoding="utf-8")
    sys.stderr.reconfigure(encoding="utf-8")
except Exception:
    pass

VERIFY_URL_BASE = "https://wheelttt.xyz/verify"
DEFAULT_KEY     = bytes.fromhex("00000000000000000000000000000000")
PICC_PLACEHOLDER = "0" * 32
CMAC_PLACEHOLDER = "0" * 16

SERIES_SERIAL = {
    "pioneer": "Lajtner Pioneer #{n:02d} of 50",
    "founder": "Lajtner Founder Series \u2014 No. {n:02d} of 50",
    "alpha":   "Lajtner Alpha Series \u2014 No. {n:03d} of 500",
    "core":    "Lajtner Core Series",
}

def make_serial(series, n):
    fmt = SERIES_SERIAL.get(series, SERIES_SERIAL["pioneer"])
    return fmt.format(n=n) if "{n" in fmt else fmt

NDEF_AID = [0xD2, 0x76, 0x00, 0x00, 0x85, 0x01, 0x01]
NDEF_FID = [0xE1, 0x04]

import typing
try:
    typing.Self
except AttributeError:
    import typing_extensions
    typing.Self = typing_extensions.Self

import sys as _sys
if _sys.version_info < (3, 11):
    try:
        from forbiddenfruit import curse
    except ImportError:
        raise SystemExit("Run:  pip install forbiddenfruit   (needed on Python 3.10)")
    _orig_int_to_bytes = int.to_bytes
    def _int_to_bytes(self, length=1, byteorder="big", *a, **kw):
        return _orig_int_to_bytes(self, length, byteorder, *a, **kw)
    curse(int, "to_bytes", _int_to_bytes)

def _conn():
    from smartcard.System import readers
    rs = [r for r in readers() if "PICC" in str(r)] or readers()
    if not rs:
        raise SystemExit("No PC/SC reader - is the ACR1552 plugged in?")
    c = rs[0].createConnection(); c.connect(); return c

class PyscardTag:
    def __init__(self, conn): self.conn = conn
    def send_apdu(self, cla, ins, p1, p2, data=b"", mrl=256, check_status=True):
        data = bytes(data)
        apdu = [cla, ins, p1, p2]
        if data:
            apdu += [len(data)] + list(data)
        apdu += [mrl & 0xFF]
        resp, sw1, sw2 = self.conn.transmit(apdu)
        return bytes(resp) + bytes([sw1, sw2])

def get_uid(conn):
    from smartcard.util import toHexString
    d, s1, s2 = conn.transmit([0xFF, 0xCA, 0x00, 0x00, 0x00])
    if (s1, s2) != (0x90, 0x00):
        raise RuntimeError("UID read failed - chip on the antenna?")
    return toHexString(d).replace(" ", "")

def build_url():
    return f"{VERIFY_URL_BASE}?picc={PICC_PLACEHOLDER}&cmac={CMAC_PLACEHOLDER}"

def build_ndef_file(url):
    uri = bytes([0x00]) + url.encode("ascii")
    rec = bytes([0xD1, 0x01, len(uri)]) + b"U" + uri
    body = rec
    file_bytes = bytes([(len(body) >> 8) & 0xFF, len(body) & 0xFF]) + body
    base = 2 + 5
    picc_off = base + url.index("picc=") + len("picc=")
    mac_off  = base + url.index("&cmac=") + len("&cmac=")
    return file_bytes, picc_off, mac_off

def _ok(conn, apdu, label):
    d, s1, s2 = conn.transmit(apdu)
    if (s1, s2) != (0x90, 0x00):
        raise RuntimeError(f"{label}: SW={s1:02X}{s2:02X}")
    return d

def write_ndef(conn, file_bytes):
    _ok(conn, [0x00, 0xA4, 0x04, 0x00, len(NDEF_AID)] + NDEF_AID + [0x00], "select AID")
    _ok(conn, [0x00, 0xA4, 0x00, 0x0C, len(NDEF_FID)] + NDEF_FID, "select NDEF file")
    _ok(conn, [0x00, 0xD6, 0, 0, 2, 0x00, 0x00], "nlen=0")
    body = file_bytes[2:]
    off = 2
    for i in range(0, len(body), 200):
        chunk = list(body[i:i+200])
        _ok(conn, [0x00, 0xD6, (off >> 8) & 0xFF, off & 0xFF, len(chunk)] + chunk, "write body")
        off += len(chunk)
    _ok(conn, [0x00, 0xD6, 0, 0, 2, file_bytes[0], file_bytes[1]], "nlen")

def _sdm_tag(shim):
    from pylibsdm.tag.ntag424dna import Tag
    return Tag(shim)

def configure_sdm(shim, picc_off, mac_off):
    from pylibsdm.tag.ntag424dna import (
        FileSettings, SDMOptions, SDMAccessRights, AccessRights, FileOption, CommMode)
    tag = _sdm_tag(shim)
    sdm_opts = SDMOptions(
        uid=True, read_ctr=True, read_ctr_limit=False,
        enc_file_data=False, tt_status=False, ascii_encoding=True,
    )
    sdm_ar = SDMAccessRights(meta_read=0x0, file_read=0x0, ctr_ret=0xF)
    fs = FileSettings(
        file_option=FileOption(sdm_enabled=True, comm_mode=CommMode.PLAIN),
        access_rights=AccessRights(read=0xE, write=0x0, read_write=0x0, change=0x0),
        sdm_options=sdm_opts,
        sdm_access_rights=sdm_ar,
        picc_data_offset=picc_off,
        mac_offset=mac_off,
        mac_input_offset=mac_off,
    )
    tag.authenticate_ev2_first(0)
    tag.change_file_settings(2, fs)
    return tag

def _pick_series(args):
    for s in ("pioneer", "founder", "alpha", "core"):
        if f"--{s}" in args:
            return s
    return "pioneer"

def _register_db(uid, serial):
    """Auto-register the chip (UID + serial) in the server whitelist after Step B.
    Uses env: API_BASE (default https://wheelttt.xyz) and MASTER_TOKEN."""
    base  = os.environ.get("API_BASE", "https://wheelttt.xyz").rstrip("/")
    token = os.environ.get("MASTER_TOKEN", "wt_master_2026")
    try:
        import json as _json, urllib.request as _u
        body = _json.dumps({"uid": uid, "serial": serial, "token": token}).encode()
        req = _u.Request(f"{base}/admin/set-chip-serial", data=body,
                         headers={"Content-Type": "application/json"}, method="POST")
        with _u.urlopen(req, timeout=10) as r:
            if r.status == 200:
                print(f"  -> registered in DB ({base})")
            else:
                print(f"  ! DB register HTTP {r.status} - add it manually")
    except Exception as e:
        print(f"  ! DB register failed ({e}) - add UID/serial manually")

def main():
    args = sys.argv[1:]
    nums = [a for a in args if a.isdigit()]
    n = int(nums[0]) if nums else 1
    series  = _pick_series(args)
    do_sdm  = "--sdm" in args
    do_key  = "--change-key" in args
    dry     = not (do_sdm or do_key)

    url = build_url()
    file_bytes, picc_off, mac_off = build_ndef_file(url)
    serial = make_serial(series, n)

    print(f"series       : {series}")
    print(f"URL template : {url}")
    print(f"picc offset  : {picc_off}   (32 hex chars)")
    print(f"cmac offset  : {mac_off}   (16 hex chars)")
    print(f"NDEF bytes   : {len(file_bytes)}")
    print(f"serial       : {serial}")

    if dry:
        print("\n[DRY RUN] nothing written. Re-run with --sdm to program (keeps default key).")
        return

    conn = _conn()
    uid = get_uid(conn)
    print(f"UID          : {uid}")
    tag = PyscardTag(conn)

    if do_sdm:
        print("\n[STEP B] writing NDEF + enabling SUN (default key kept - reversible)…")
        write_ndef(conn, file_bytes)
        configure_sdm(tag, picc_off, mac_off)
        print("DONE. Now TAP the chip with a phone.")
        _register_db(uid, serial)
        print(f"\nRegister in DB ->  UID={uid}  serial=\"{serial}\"")

    if do_key:
        key_hex = os.environ.get("NTAG_KEY", "")
        if len(key_hex) != 32:
            raise SystemExit("Set env NTAG_KEY to your 32-hex key first.")
        new_key = bytes.fromhex(key_hex)
        print("\n[STEP C] changing app key default -> NTAG_KEY (IRREVERSIBLE without the key)…")
        tag = _sdm_tag(tag)
        tag.authenticate_ev2_first(0)
        tag.change_key(0, new_key, version=1)
        print("KEY CHANGED. Update server NTAG_KEY to the SAME key, then tap to confirm.")
        print(f"\nLog line ->  {uid},\"{serial}\"")

if __name__ == "__main__":
    main()
