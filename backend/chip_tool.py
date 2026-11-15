"""
chip_tool.py — GUI for reading / writing Lajtner NFC chips (NTAG 424 DNA).

Features:
  - Read chip: shows UID + NDEF URL
  - Write chip (Step B): NDEF + SUN, default key (reversible), auto-registers in DB
  - Write chip (Step C, Permanent): changes key (irreversible), needs NTAG_KEY
  - Series picker + chip number
  - Log output area

Build standalone .exe (no Python needed to run):
    pip install pyinstaller pyscard pylibsdm --pre
    pyinstaller --onefile --noconsole --name ChipTool chip_tool.py
    → dist/ChipTool.exe
"""
import sys, os, threading, traceback

try:
    sys.stdout.reconfigure(encoding="utf-8")
    sys.stderr.reconfigure(encoding="utf-8")
except Exception:
    pass

import tkinter as tk
from tkinter import ttk

# ── NFC constants ──
VERIFY_URL_BASE  = "https://wheelttt.xyz/verify"
DEFAULT_KEY      = bytes.fromhex("00000000000000000000000000000000")
PICC_PLACEHOLDER = "0" * 32
CMAC_PLACEHOLDER = "0" * 16
NDEF_AID = [0xD2, 0x76, 0x00, 0x00, 0x85, 0x01, 0x01]
NDEF_FID = [0xE1, 0x04]

API_BASE     = "https://wheelttt.xyz"
MASTER_TOKEN = "wt_master_2026"

SERIES_SERIAL = {
    "pioneer":  "Lajtner Pioneer Series #{n:02d} of {total}",
    "spectrum": "Lajtner Spectrum Series No. {n:02d} of {total}",
    "core":     "Lajtner Core Series #{n:02d} of {total}",
    "founder":  "Lajtner Founder Series No. {n:02d} of {total}",
}

# ── pylibsdm compat shims ──
import typing
try:
    typing.Self
except AttributeError:
    import typing_extensions
    typing.Self = typing_extensions.Self

if sys.version_info < (3, 11):
    try:
        from forbiddenfruit import curse
        _orig = int.to_bytes
        def _itb(self, length=1, byteorder="big", *a, **kw):
            return _orig(self, length, byteorder, *a, **kw)
        curse(int, "to_bytes", _itb)
    except ImportError:
        pass

# ── chip helpers (no subprocess, everything inline) ──

def make_serial(series, n, total=50):
    fmt = SERIES_SERIAL.get(series, SERIES_SERIAL["pioneer"])
    return fmt.format(n=n, total=total)

def get_connection():
    from smartcard.System import readers
    rs = [r for r in readers() if "PICC" in str(r)] or readers()
    if not rs:
        raise RuntimeError("No PC/SC reader found.\nIs the ACR1552 plugged in?")
    c = rs[0].createConnection()
    c.connect()
    return c

def get_uid(conn):
    from smartcard.util import toHexString
    d, s1, s2 = conn.transmit([0xFF, 0xCA, 0x00, 0x00, 0x00])
    if (s1, s2) != (0x90, 0x00):
        raise RuntimeError(f"UID read failed (SW={s1:02X}{s2:02X}).\nPlace chip on reader.")
    return toHexString(d).replace(" ", "")

def tx(conn, apdu, label):
    d, s1, s2 = conn.transmit(apdu)
    if (s1, s2) != (0x90, 0x00):
        raise RuntimeError(f"{label}: SW={s1:02X}{s2:02X}")
    return d

def read_ndef(conn):
    tx(conn, [0x00, 0xA4, 0x04, 0x00, len(NDEF_AID)] + NDEF_AID + [0x00], "select AID")
    tx(conn, [0x00, 0xA4, 0x00, 0x0C, len(NDEF_FID)] + NDEF_FID, "select NDEF file")
    hdr = tx(conn, [0x00, 0xB0, 0x00, 0x00, 0x02], "read nlen")
    nlen = (hdr[0] << 8) | hdr[1]
    if nlen == 0:
        return "(empty)"
    body = []
    off, rem = 2, nlen
    while rem > 0:
        chunk = min(200, rem)
        d = tx(conn, [0x00, 0xB0, (off >> 8) & 0xFF, off & 0xFF, chunk], "read body")
        body += list(d); off += chunk; rem -= chunk
    txt = bytes(body).decode("ascii", errors="replace")
    i = txt.find("http")
    return txt[i:] if i >= 0 else txt

def build_url():
    return f"{VERIFY_URL_BASE}?picc={PICC_PLACEHOLDER}&cmac={CMAC_PLACEHOLDER}"

def build_ndef_file(url):
    uri = bytes([0x00]) + url.encode("ascii")
    rec = bytes([0xD1, 0x01, len(uri)]) + b"U" + uri
    fb = bytes([(len(rec) >> 8) & 0xFF, len(rec) & 0xFF]) + rec
    base = 2 + 5
    picc_off = base + url.index("picc=") + len("picc=")
    mac_off  = base + url.index("&cmac=") + len("&cmac=")
    return fb, picc_off, mac_off

def write_ndef(conn, fb):
    tx(conn, [0x00, 0xA4, 0x04, 0x00, len(NDEF_AID)] + NDEF_AID + [0x00], "select AID")
    tx(conn, [0x00, 0xA4, 0x00, 0x0C, len(NDEF_FID)] + NDEF_FID, "select NDEF file")
    tx(conn, [0x00, 0xD6, 0, 0, 2, 0x00, 0x00], "nlen=0")
    body = fb[2:]
    off = 2
    for i in range(0, len(body), 200):
        chunk = list(body[i:i+200])
        tx(conn, [0x00, 0xD6, (off >> 8) & 0xFF, off & 0xFF, len(chunk)] + chunk, "write")
        off += len(chunk)
    tx(conn, [0x00, 0xD6, 0, 0, 2, fb[0], fb[1]], "nlen")

class PyscardTag:
    def __init__(self, conn):
        self.conn = conn
    def send_apdu(self, cla, ins, p1, p2, data=b"", mrl=256, check_status=True):
        data = bytes(data)
        apdu = [cla, ins, p1, p2]
        if data:
            apdu += [len(data)] + list(data)
        apdu += [mrl & 0xFF]
        resp, sw1, sw2 = self.conn.transmit(apdu)
        return bytes(resp) + bytes([sw1, sw2])

def configure_sdm(shim, picc_off, mac_off, write_access=0x0):
    from pylibsdm.tag.ntag424dna import (
        Tag, FileSettings, SDMOptions, SDMAccessRights,
        AccessRights, FileOption, CommMode)
    tag = Tag(shim)
    sdm_opts = SDMOptions(
        uid=True, read_ctr=True, read_ctr_limit=False,
        enc_file_data=False, tt_status=False, ascii_encoding=True)
    sdm_ar = SDMAccessRights(meta_read=0x0, file_read=0x0, ctr_ret=0xF)
    fs = FileSettings(
        file_option=FileOption(sdm_enabled=True, comm_mode=CommMode.PLAIN),
        access_rights=AccessRights(read=0xE, write=write_access,
                                   read_write=write_access, change=0x0),
        sdm_options=sdm_opts, sdm_access_rights=sdm_ar,
        picc_data_offset=picc_off, mac_offset=mac_off, mac_input_offset=mac_off)
    tag.authenticate_ev2_first(0)
    tag.change_file_settings(2, fs)
    return tag

def change_key(shim, key_hex):
    from pylibsdm.tag.ntag424dna import Tag
    new_key = bytes.fromhex(key_hex)
    tag = Tag(shim)
    tag.authenticate_ev2_first(0)
    tag.change_key(0, new_key, version=1)

def register_db(uid, serial):
    import json, urllib.request
    body = json.dumps({"uid": uid, "serial": serial, "token": MASTER_TOKEN}).encode()
    req = urllib.request.Request(
        f"{API_BASE}/admin/set-chip-serial", data=body,
        headers={"Content-Type": "application/json"}, method="POST")
    with urllib.request.urlopen(req, timeout=10) as r:
        return r.status == 200

# ── GUI ──

BG       = "#1e1e2e"
BG2      = "#2a2a3e"
FG       = "#e0e0e0"
ACCENT   = "#ff8800"
GREEN    = "#00cc66"
RED      = "#ff4466"
BORDER   = "#3a3a50"
FONT     = ("Segoe UI", 10)
FONT_B   = ("Segoe UI", 10, "bold")
FONT_LOG = ("Consolas", 9)

class ChipToolApp:
    def __init__(self):
        self.root = tk.Tk()
        self.root.title("Lajtner Chip Tool")
        self.root.configure(bg=BG)
        self.root.geometry("520x620")
        self.root.resizable(False, False)
        self._build_ui()

    def _build_ui(self):
        r = self.root

        # Title
        tk.Label(r, text="Lajtner Chip Tool", font=("Segoe UI", 16, "bold"),
                 fg=ACCENT, bg=BG).pack(pady=(14, 6))

        # ── Settings frame ──
        sf = tk.Frame(r, bg=BG2, highlightbackground=BORDER,
                      highlightthickness=1, padx=16, pady=12)
        sf.pack(padx=16, pady=(4, 8), fill="x")

        # Series
        row = tk.Frame(sf, bg=BG2)
        row.pack(fill="x", pady=3)
        tk.Label(row, text="Series:", font=FONT_B, fg=FG, bg=BG2, width=10, anchor="w").pack(side="left")
        self.series_var = tk.StringVar(value="pioneer")
        cb = ttk.Combobox(row, textvariable=self.series_var, state="readonly", width=18,
                          values=["pioneer", "spectrum", "founder", "core"])
        cb.pack(side="left", padx=(4, 0))

        # Number + Total on same row
        row2 = tk.Frame(sf, bg=BG2)
        row2.pack(fill="x", pady=3)
        tk.Label(row2, text="Number:", font=FONT_B, fg=FG, bg=BG2, width=10, anchor="w").pack(side="left")
        self.num_var = tk.StringVar(value="1")
        tk.Entry(row2, textvariable=self.num_var, font=FONT, width=6,
                 bg=BG, fg=FG, insertbackground=FG, relief="flat",
                 highlightbackground=BORDER, highlightthickness=1).pack(side="left", padx=(4, 0))

        tk.Label(row2, text="of", font=FONT, fg=FG, bg=BG2).pack(side="left", padx=(10, 4))
        self.total_var = tk.StringVar(value="50")
        tk.Entry(row2, textvariable=self.total_var, font=FONT, width=6,
                 bg=BG, fg=FG, insertbackground=FG, relief="flat",
                 highlightbackground=BORDER, highlightthickness=1).pack(side="left")

        # Permanent key checkbox
        row3 = tk.Frame(sf, bg=BG2)
        row3.pack(fill="x", pady=(8, 3))
        self.perm_var = tk.BooleanVar(value=False)
        self.perm_cb = tk.Checkbutton(
            row3, text="Permanent key (IRREVERSIBLE)", font=FONT_B,
            variable=self.perm_var, fg=RED, bg=BG2, selectcolor=BG,
            activebackground=BG2, activeforeground=RED, command=self._toggle_key)
        self.perm_cb.pack(side="left")

        # Key input
        self.key_frame = tk.Frame(sf, bg=BG2)
        tk.Label(self.key_frame, text="NTAG_KEY:", font=FONT_B, fg=FG, bg=BG2, width=10, anchor="w").pack(side="left")
        self.key_var = tk.StringVar()
        tk.Entry(self.key_frame, textvariable=self.key_var, font=FONT_LOG, width=34,
                 bg=BG, fg=FG, insertbackground=FG, relief="flat",
                 highlightbackground=BORDER, highlightthickness=1).pack(side="left", padx=(4, 0))
        # hidden by default
        # self.key_frame.pack(fill="x", pady=3)

        # ── Buttons ──
        bf = tk.Frame(r, bg=BG)
        bf.pack(pady=8)

        self.read_btn = tk.Button(
            bf, text="📖  Read Chip", font=FONT_B, fg=BG, bg=GREEN,
            activebackground="#00aa55", relief="flat", padx=20, pady=8,
            cursor="hand2", command=self._on_read)
        self.read_btn.pack(side="left", padx=8)

        self.write_btn = tk.Button(
            bf, text="✏️  Write Chip", font=FONT_B, fg=BG, bg=ACCENT,
            activebackground="#cc6e00", relief="flat", padx=20, pady=8,
            cursor="hand2", command=self._on_write)
        self.write_btn.pack(side="left", padx=8)

        # ── Log ──
        lf = tk.Frame(r, bg=BG)
        lf.pack(padx=16, pady=(4, 12), fill="both", expand=True)

        tk.Label(lf, text="Log", font=FONT_B, fg=FG, bg=BG, anchor="w").pack(fill="x")
        self.log = tk.Text(lf, font=FONT_LOG, bg=BG2, fg=FG, relief="flat",
                           highlightbackground=BORDER, highlightthickness=1,
                           wrap="word", state="disabled", height=14)
        self.log.pack(fill="both", expand=True, pady=(4, 0))
        self.log.tag_configure("ok",    foreground=GREEN)
        self.log.tag_configure("err",   foreground=RED)
        self.log.tag_configure("info",  foreground=ACCENT)

    def _toggle_key(self):
        if self.perm_var.get():
            self.key_frame.pack(fill="x", pady=3)
            self.write_btn.configure(bg=RED, activebackground="#cc2244", text="🔒  Write + Lock Key")
        else:
            self.key_frame.pack_forget()
            self.write_btn.configure(bg=ACCENT, activebackground="#cc6e00", text="✏️  Write Chip")

    def _log(self, text, tag=None):
        self.log.configure(state="normal")
        self.log.insert("end", text + "\n", tag)
        self.log.see("end")
        self.log.configure(state="disabled")

    def _set_buttons(self, enabled):
        st = "normal" if enabled else "disabled"
        self.read_btn.configure(state=st)
        self.write_btn.configure(state=st)

    # ── Read ──
    def _on_read(self):
        self._set_buttons(False)
        self._log("─── READ ───", "info")
        threading.Thread(target=self._do_read, daemon=True).start()

    def _do_read(self):
        try:
            conn = get_connection()
            uid = get_uid(conn)
            self.root.after(0, self._log, f"UID:  {uid}", "ok")
            ndef = read_ndef(conn)
            self.root.after(0, self._log, f"NDEF: {ndef}", "ok")
        except Exception as e:
            self.root.after(0, self._log, f"ERROR: {e}", "err")
        finally:
            self.root.after(0, self._set_buttons, True)

    # ── Write ──
    def _on_write(self):
        try:
            n = int(self.num_var.get())
        except ValueError:
            self._log("ERROR: number must be an integer", "err")
            return
        try:
            total = int(self.total_var.get())
        except ValueError:
            self._log("ERROR: total must be an integer", "err")
            return
        if total < 1:
            self._log("ERROR: total must be at least 1", "err")
            return
        if n < 1:
            self._log("ERROR: number must be at least 1", "err")
            return

        series = self.series_var.get()
        perm = self.perm_var.get()
        key_hex = self.key_var.get().strip().replace(" ", "")

        if perm:
            if len(key_hex) != 32:
                self._log("ERROR: NTAG_KEY must be exactly 32 hex characters", "err")
                return
            try:
                bytes.fromhex(key_hex)
            except ValueError:
                self._log("ERROR: NTAG_KEY contains invalid hex characters", "err")
                return
            # confirm
            if not tk.messagebox.askyesno(
                    "Permanent Key",
                    "WARNING: This will change the chip key.\n"
                    "The chip will NOT be re-writable without this key.\n\n"
                    "Are you sure?",
                    icon="warning"):
                self._log("Cancelled.", "info")
                return

        self._set_buttons(False)
        serial = make_serial(series, n, total)
        self._log(f"─── WRITE: {series} #{n:02d} of {total} ───", "info")
        self._log(f"Serial: {serial}")

        threading.Thread(target=self._do_write,
                         args=(series, n, serial, perm, key_hex),
                         daemon=True).start()

    def _do_write(self, series, n, serial, perm, key_hex):
        try:
            conn = get_connection()
            uid = get_uid(conn)
            self.root.after(0, self._log, f"UID: {uid}")

            # Step B: write NDEF + enable SUN
            url = build_url()
            fb, picc_off, mac_off = build_ndef_file(url)
            shim = PyscardTag(conn)

            self.root.after(0, self._log, "[Step B] Writing NDEF + SUN...")
            try:
                write_ndef(conn, fb)
            except RuntimeError as e:
                if "6982" not in str(e):
                    raise
                # SW=6982 — chip was previously programmed (write needs auth).
                # Temporarily set write=0xE (free), reset card, write, restore.
                self.root.after(0, self._log,
                    "Chip already programmed — unlocking for re-write...", "info")
                configure_sdm(shim, picc_off, mac_off, write_access=0xE)
                conn.disconnect()
                conn.connect()
                write_ndef(conn, fb)
                self.root.after(0, self._log, "Re-write OK, restoring access rights...")
                shim = PyscardTag(conn)
            configure_sdm(shim, picc_off, mac_off)
            self.root.after(0, self._log, "NDEF + SUN written OK", "ok")

            # Register in DB
            self.root.after(0, self._log, "Registering in database...")
            try:
                ok = register_db(uid, serial)
                if ok:
                    self.root.after(0, self._log, f"DB: registered  UID={uid}  serial=\"{serial}\"", "ok")
                else:
                    self.root.after(0, self._log, "DB: HTTP error — register manually", "err")
            except Exception as e:
                self.root.after(0, self._log, f"DB: {e} — register manually", "err")

            # Step C: permanent key (optional)
            if perm:
                self.root.after(0, self._log, "[Step C] Changing key (IRREVERSIBLE)...", "info")
                change_key(shim, key_hex)
                self.root.after(0, self._log, "KEY CHANGED — chip is now locked to this key", "ok")

            self.root.after(0, self._log, f"\nDONE. Tap chip with phone to verify.\n", "ok")

        except Exception as e:
            self.root.after(0, self._log, f"ERROR: {e}", "err")
            self.root.after(0, self._log, traceback.format_exc(), "err")
        finally:
            self.root.after(0, self._set_buttons, True)

    def run(self):
        self.root.mainloop()

if __name__ == "__main__":
    import tkinter.messagebox
    ChipToolApp().run()