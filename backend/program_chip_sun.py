"""
program_chip_sun.py — NTAG 424 DNA · STAGE 2 (SUN / "secret code").

Transport: ACR1552 via PC/SC (pyscard). SUN crypto/secure-messaging: pylibsdm
(which only touches the tag through send_apdu, so we bridge it to pyscard).

WHAT THIS DOES — in SAFE stages, so nothing irreversible happens until proven:

  Step A  (default: --dry-run)  build the NDEF URL with picc/cmac placeholders,
          compute the SDM mirror offsets, print the plan. NO chip access.

  Step B  (--sdm)  authenticate with the DEFAULT key, write the NDEF, enable
          SDM/SUN. The key STAYS default → fully reversible. Now tap the chip:
          it produces a REAL picc+cmac. Verify it against the server with
          NTAG_KEY = the default key. If /verify accepts it, the offsets/config
          are correct and we proved the whole thing with zero risk.

  Step C  (--change-key)  ONLY after Step B taps verify. Change the app key from
          default to your real NTAG_KEY. This is the irreversible step (you can
          still re-key later, but ONLY if you know the current key — never lose
          NTAG_KEY). No file locking is done.

Env:
    NTAG_KEY   your 32-hex batch key (used only in Step C). Read from env, never hardcoded.

Usage:
    python program_chip_sun.py 1                 # Step A — dry run, prints the plan
    python program_chip_sun.py 1 --sdm           # Step B — enable SUN, keep default key
    python program_chip_sun.py 1 --change-key     # Step C — set your real key (irreversible)
"""
import sys, os

VERIFY_URL_BASE = "https://wheelttt.xyz/verify"
SERIAL_FMT      = "Lajtner Inventor Series \u2014 No. {n:02d} of 50"
DEFAULT_KEY     = bytes.fromhex("00000000000000000000000000000000")  # NTAG424 factory key = all zeros
PICC_PLACEHOLDER = "0" * 32   # 16-byte encrypted PICC → 32 hex chars mirrored by the chip
CMAC_PLACEHOLDER = "0" * 16   # 8-byte SDM MAC → 16 hex chars

NDEF_AID = [0xD2, 0x76, 0x00, 0x00, 0x85, 0x01, 0x01]
NDEF_FID = [0xE1, 0x04]

# ── Python 3.10 shims for pylibsdm (written for 3.11) ───────────────────────
import typing
try:
    typing.Self
except AttributeError:
    import typing_extensions
    typing.Self = typing_extensions.Self

# pylibsdm calls int.to_bytes() with no args (3.11 defaults to length=1, big-endian).
# On 3.10 length is required. We patch ONLY int.to_bytes (via forbiddenfruit, which
# can curse built-in types) — object .to_bytes() methods (FileSettings etc.) are left
# completely alone, so nothing else breaks.
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

# ── pyscard transport ───────────────────────────────────────────────────────
def _conn():
    from smartcard.System import readers
    rs = [r for r in readers() if "PICC" in str(r)] or readers()
    if not rs:
        raise SystemExit("No PC/SC reader — is the ACR1552 plugged in?")
    c = rs[0].createConnection(); c.connect(); return c

class PyscardTag:
    """Minimal shim implementing the one method pylibsdm calls: send_apdu()."""
    def __init__(self, conn): self.conn = conn
    def send_apdu(self, cla, ins, p1, p2, data=b"", mrl=256, check_status=True):
        data = bytes(data)
        apdu = [cla, ins, p1, p2]
        if data:
            apdu += [len(data)] + list(data)
        apdu += [mrl & 0xFF]                       # Le (0x00 = 256)
        resp, sw1, sw2 = self.conn.transmit(apdu)
        return bytes(resp) + bytes([sw1, sw2])

def get_uid(conn):
    from smartcard.util import toHexString
    d, s1, s2 = conn.transmit([0xFF, 0xCA, 0x00, 0x00, 0x00])
    if (s1, s2) != (0x90, 0x00):
        raise RuntimeError("UID read failed — chip on the antenna?")
    return toHexString(d).replace(" ", "")

# ── NDEF url + offset computation ───────────────────────────────────────────
def build_url():
    return (f"{VERIFY_URL_BASE}?picc={PICC_PLACEHOLDER}&cmac={CMAC_PLACEHOLDER}")

def build_ndef_file(url):
    """Return (file_bytes, picc_offset, mac_offset) — offsets are byte positions
    of the placeholders inside the NDEF *file* (NLEN prefix included)."""
    uri = bytes([0x00]) + url.encode("ascii")           # 0x00 = no URI abbreviation
    rec = bytes([0xD1, 0x01, len(uri)]) + b"U" + uri     # MB|ME|SR, type 'U'
    body = rec
    file_bytes = bytes([(len(body) >> 8) & 0xFF, len(body) & 0xFF]) + body
    base = 2 + 5                                          # NLEN(2) + rec hdr(0xD1,01,len,'U',0x00 id)
    picc_off = base + url.index("picc=") + len("picc=")
    mac_off  = base + url.index("&cmac=") + len("&cmac=")
    return file_bytes, picc_off, mac_off

# ── ISO helpers (NDEF write, since pylibsdm.write_data is unimplemented) ─────
def _ok(conn, apdu, label):
    d, s1, s2 = conn.transmit(apdu)
    if (s1, s2) != (0x90, 0x00):
        raise RuntimeError(f"{label}: SW={s1:02X}{s2:02X}")
    return d

def write_ndef(conn, file_bytes):
    _ok(conn, [0x00, 0xA4, 0x04, 0x00, len(NDEF_AID)] + NDEF_AID + [0x00], "select AID")
    _ok(conn, [0x00, 0xA4, 0x00, 0x0C, len(NDEF_FID)] + NDEF_FID, "select NDEF file")
    # write NLEN=0, body, then real NLEN
    _ok(conn, [0x00, 0xD6, 0, 0, 2, 0x00, 0x00], "nlen=0")
    body = file_bytes[2:]
    off = 2
    for i in range(0, len(body), 200):
        chunk = list(body[i:i+200])
        _ok(conn, [0x00, 0xD6, (off >> 8) & 0xFF, off & 0xFF, len(chunk)] + chunk, "write body")
        off += len(chunk)
    _ok(conn, [0x00, 0xD6, 0, 0, 2, file_bytes[0], file_bytes[1]], "nlen")

def _sdm_tag(shim):
    """Wrap the pyscard transport shim in a pylibsdm NTAG424 Tag (crypto layer)."""
    from pylibsdm.tag.ntag424dna import Tag
    return Tag(shim)

# ── SDM / SUN configuration via pylibsdm ────────────────────────────────────
def configure_sdm(shim, picc_off, mac_off):
    from pylibsdm.tag.ntag424dna import (
        FileSettings, SDMOptions, SDMAccessRights, AccessRights, FileOption, CommMode)
    tag = _sdm_tag(shim)
    sdm_opts = SDMOptions(
        uid=True, read_ctr=True, read_ctr_limit=False,
        enc_file_data=False, tt_status=False, ascii_encoding=True,
    )
    sdm_ar = SDMAccessRights(meta_read=0x0, file_read=0x0, ctr_ret=0xF)  # key 0 for both
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
    tag.change_file_settings(2, fs)   # File 02 = NDEF
    return tag

def main():
    args = sys.argv[1:]
    nums = [a for a in args if a.isdigit()]
    n = int(nums[0]) if nums else 1
    do_sdm  = "--sdm" in args
    do_key  = "--change-key" in args
    dry     = not (do_sdm or do_key)

    url = build_url()
    file_bytes, picc_off, mac_off = build_ndef_file(url)
    serial = SERIAL_FMT.format(n=n)

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
        print("\n[STEP B] writing NDEF + enabling SUN (default key kept — reversible)…")
        write_ndef(conn, file_bytes)
        configure_sdm(tag, picc_off, mac_off)
        print("DONE. Now TAP the chip with a phone. It will open a URL like")
        print("  …/verify?picc=<32 hex>&cmac=<16 hex>")
        print("Verify it against the server with NTAG_KEY = 00000000000000000000000000000000")
        print("If /verify accepts it → offsets are correct → then run --change-key.")

    if do_key:
        key_hex = os.environ.get("NTAG_KEY", "")
        if len(key_hex) != 32:
            raise SystemExit("Set env NTAG_KEY to your 32-hex key first.")
        new_key = bytes.fromhex(key_hex)
        print("\n[STEP C] changing app key default → NTAG_KEY (IRREVERSIBLE without the key)…")
        tag = _sdm_tag(tag)
        tag.authenticate_ev2_first(0)
        tag.change_key(0, new_key, version=1)
        print("KEY CHANGED. Update the server NTAG_KEY to the SAME key, then tap again to confirm.")
        print(f"\nLog line →  {uid},{n:02d},\"{serial}\"")

if __name__ == "__main__":
    main()