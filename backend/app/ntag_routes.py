# -*- coding: utf-8 -*-
"""
NTAG 424 DNA verification flow for FastAPI — works NOW without a physical chip.

Wire into main.py:
    from app.ntag_routes import router as ntag_router
    app.include_router(ntag_router)

Env vars:
    NTAG_KEY              32 hex chars (16 bytes) — shared AES key (same one burned into the tags)
    FRONTEND_MEASURE_URL  where to send the browser after success (e.g. https://mindpw.com/kinetic/upload)
    VERIFY_BASE           public base of THIS API (e.g. https://wheelttt.xyz) — used by /sim
    NTAG_SIM              "1" to enable the /sim test endpoint, "0" in production
    NTAG_STORE            "supabase" (default) or "memory" (local testing without a DB)

Storage:
    supabase -> reuses app.database._sb(); run ntag_tags.sql once for `tags` + `device_sessions`.
    memory   -> keeps everything in process RAM (lost on restart) — handy for local tests.
"""
import os, time, secrets, logging
from fastapi import APIRouter, HTTPException, Query
from fastapi.responses import RedirectResponse, JSONResponse
from app.ntag424 import verify_sun, simulate_sun
from app.database import _sb as _db_sb

log = logging.getLogger(__name__)
router = APIRouter()

NTAG_KEY = bytes.fromhex(os.environ.get("NTAG_KEY", "00112233445566778899AABBCCDDEEFF"))
FRONTEND_MEASURE_URL = os.environ.get("FRONTEND_MEASURE_URL", "https://mindpw.com/kinetic/upload")
VERIFY_BASE = os.environ.get("VERIFY_BASE", "")
SIM_ENABLED = os.environ.get("NTAG_SIM", "1") == "1"
SESSION_TTL = 300
NTAG_STORE = os.environ.get("NTAG_STORE", "supabase").lower()   # "supabase" | "memory"

# in-memory store (used when NTAG_STORE=memory). Seeded with the test UID.
_MEM_TAGS = {"04A1B2C3D4E580": {"last_counter": -1}}
_MEM_SESS: dict = {}

_use_memory = (NTAG_STORE == "memory")


def _sb():
    sb = _db_sb()
    if not sb:
        raise HTTPException(500, "DB unavailable")
    return sb


# ── storage layer (memory or supabase) ──────────────────────────────────────

def tag_get(uid):
    if _use_memory:
        return _MEM_TAGS.get(uid)
    r = _sb().table("tags").select("uid,last_counter").eq("uid", uid).limit(1).execute()
    return r.data[0] if r.data else None


def tag_set_counter(uid, counter):
    if _use_memory:
        _MEM_TAGS.setdefault(uid, {})["last_counter"] = counter
        return
    _sb().table("tags").update({"last_counter": counter}).eq("uid", uid).execute()


def session_create(token, uid):
    rec = {"token": token, "uid": uid, "authorized": True,
           "expires_at": int(time.time()) + SESSION_TTL, "used": False}
    if _use_memory:
        _MEM_SESS[token] = rec
        return
    _sb().table("device_sessions").insert(rec).execute()


def session_get(token):
    if _use_memory:
        return _MEM_SESS.get(token)
    r = _sb().table("device_sessions").select("*").eq("token", token).limit(1).execute()
    return r.data[0] if r.data else None


def session_mark_used(token):
    if _use_memory:
        if token in _MEM_SESS:
            _MEM_SESS[token]["used"] = True
        return
    _sb().table("device_sessions").update({"used": True}).eq("token", token).execute()


# ── endpoints ────────────────────────────────────────────────────────────────

def _deny(msg: str):
    return JSONResponse({"status": "unauthorized", "message": msg}, status_code=403)


@router.get("/verify")
def verify(picc: str = Query(...), cmac: str = Query(...)):
    res = verify_sun(NTAG_KEY, picc, cmac)
    if not res.get("valid"):
        return _deny("Invalid or counterfeit tag")
    uid, counter = res["uid"], res["counter"]

    tag = tag_get(uid)
    if not tag:
        return _deny("Unknown device")
    last = tag.get("last_counter")
    last = -1 if last is None else int(last)
    if counter <= last:
        return _deny("Replay detected")
    tag_set_counter(uid, counter)

    token = secrets.token_urlsafe(24)
    session_create(token, uid)
    return RedirectResponse(f"{FRONTEND_MEASURE_URL}?dev_token={token}", status_code=302)


@router.get("/device-session")
def device_session(token: str = Query(...)):
    s = session_get(token)
    if not s:
        raise HTTPException(404, "invalid token")
    if s.get("used") or int(s.get("expires_at", 0)) < int(time.time()):
        raise HTTPException(403, "token expired or already used")
    session_mark_used(token)
    return {"authorized": True, "uid": s["uid"]}


@router.get("/sim")
def sim(uid: str = Query("04A1B2C3D4E580"), counter: int = Query(1)):
    if not SIM_ENABLED:
        raise HTTPException(404, "disabled")
    picc, cmac = simulate_sun(NTAG_KEY, bytes.fromhex(uid), counter)
    return {
        "picc": picc, "cmac": cmac,
        "tap_url": f"{VERIFY_BASE}/verify?picc={picc}&cmac={cmac}",
        "store": "memory" if _use_memory else "supabase",
        "note": "open tap_url to simulate tapping this tag",
    }
