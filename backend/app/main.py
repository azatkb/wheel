"""
main.py — FastAPI server — full pipeline.

Endpoints:
  POST /upload              Upload video + job params
  GET  /status/{id}         Poll job
  GET  /progress/{id}       Live detection data
  GET  /frames/{id}         SSE stream of detection JSON
  GET  /download/{id}       Download processed video
  GET  /results/{id}        JSON samples
  GET  /csv/{id}            Download CSV
  GET  /physics/{id}        Physics calculation results
  WS   /stream              Real-time webcam detection
  GET  /health
"""

from dotenv import load_dotenv; load_dotenv()
import uuid, os, shutil, asyncio, json, logging, math, datetime, hashlib, secrets
from pathlib import Path
from concurrent.futures import ThreadPoolExecutor

import cv2
import numpy as np
from fastapi import FastAPI, UploadFile, File, Form, WebSocket, WebSocketDisconnect, HTTPException, Request
from fastapi.responses import FileResponse, HTMLResponse, StreamingResponse
from fastapi.middleware.cors import CORSMiddleware

from app.config import (
    INPUTS_DIR, OUTPUTS_DIR, SAMPLES_PER_SECOND,
    SUPABASE_URL, BAR_HEIGHT,
    DEFAULT_DIRECTION, DEFAULT_MEDIUM, DEFAULT_HAND, DEFAULT_INFO_LEVEL,
    PREPROCESS_ENABLED, DETECT_OTHER_COLORS, DRAW_MESH_OVERLAY,
)
from app.detector_seg import (
    load_yolo_seg, detect_seg,
    find_spoke_tips, find_orange_tip, find_all_tip_colors,
    orange_angle, unwrap,
    draw_seg_overlay,
    YOLO_EVERY, SMOOTH_N as SEG_SMOOTH_N,
)
from app.physics import (
    detect_phases, calculate, build_csv_row,
    build_user_message, format_si, format_sci, format_math,
)
from app.preprocessor import preprocess_video, get_video_info
from app.database import (
    create_job, finish_job, make_sample,
    persist_samples, read_samples, get_csv_path,
    get_user_history, save_physics_result, get_all_jobs, get_group_averages,
    get_master_data, get_user_bar_data, export_to_master_csv,
)
from app.stabilizer import Stabilizer

logging.basicConfig(level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s - %(message)s")
log = logging.getLogger(__name__)

# ── App settings ───────────────────────────────────────────────────────────
WATERMARK_TEXT       = "LAJTNER.com"
MAX_ANGLE_JUMP       = 30.0   # degrees — reject spoke-hop jumps
DEFAULT_LANG         = "en"
DEFAULT_VERSION      = "basic"
SAMPLE_INTERVAL_MS   = 1000
OUTLIER_THRESHOLD_DEG= 3600
DEFAULT_AVERAGES     = {
    "cumulative_deg": 90.0,
    "omega_max":      0.5,
    "W_total_air":    1e-8,
    "F_max_air":      1e-6,
}

# ── CORS ───────────────────────────────────────────────────────────────────
app = FastAPI(title="Wheel Tracker", version="5.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"], allow_credentials=True,
    allow_methods=["*"], allow_headers=["*"], expose_headers=["*"],
)

executor = ThreadPoolExecutor(max_workers=2)
jobs: dict = {}
_seg  = load_yolo_seg()          # segmentation model (cpica)
_TMPL = Path(__file__).parent / "templates"

# ── Frontend ───────────────────────────────────────────────────────────────
def _tmpl(name):
    p = _TMPL / name
    if p.exists(): return p.read_text(encoding="utf-8")
    raise HTTPException(404, f"{name} not found")

@app.get("/", response_class=HTMLResponse)
@app.get("/upload.html", response_class=HTMLResponse)
async def page_upload():
    return HTMLResponse(_tmpl("upload.html"),
                        headers={"Content-Type":"text/html; charset=utf-8"})

@app.get("/stream.html", response_class=HTMLResponse)
@app.get("/stream-test", response_class=HTMLResponse)
async def page_stream():
    return HTMLResponse(_tmpl("stream.html"),
                        headers={"Content-Type":"text/html; charset=utf-8"})

@app.get("/history.html", response_class=HTMLResponse)
@app.get("/history", response_class=HTMLResponse)
async def page_history():
    return HTMLResponse(_tmpl("history.html"),
                        headers={"Content-Type":"text/html; charset=utf-8"})

# ── Physics helper ─────────────────────────────────────────────────────────
def _run_physics(samples, medium, direction, user_email, job_id, version, lang):
    if not samples:
        return {}
    timestamps = [s["timestamp_sec"] for s in samples]
    _cum_raw   = [s["cumulative_deg"] or 0 for s in samples]

    # Filter cumulative by selected direction:
    # CW = negative angles, CCW = positive angles
    # If wheel moved in WRONG direction → set to 0 (no valid motion)
    _dir = (direction or 'cw').lower().split('+')[0].strip()
    if _dir == 'cw':
        # CW: keep negative values, zero out positive
        _cum_filtered = [min(c, 0) for c in _cum_raw]
    elif _dir == 'ccw':
        # CCW: keep positive values, zero out negative
        _cum_filtered = [max(c, 0) for c in _cum_raw]
    else:
        _cum_filtered = _cum_raw

    angles_rad = [math.radians(c) for c in _cum_filtered]
    phases = detect_phases(timestamps, angles_rad, direction_filter=direction)
    result = calculate(phases)
    max_cum_deg = max((abs(c) for c in _cum_filtered), default=0)
    result["max_cum_deg"] = max_cum_deg

    cum_deg    = abs(samples[-1].get("cumulative_deg", 0))
    is_outlier = cum_deg > OUTLIER_THRESHOLD_DEG
    history = []
    try:
        history = get_user_history(user_email)
    except Exception:
        pass
    if len(history) < 2:
        user_avg = DEFAULT_AVERAGES.copy()
    else:
        user_avg = {
            "cumulative_deg": sum(abs(h.get("cumulative_deg",0)) for h in history)/len(history),  # abs for ranking
            "W_total_air":    sum(h.get("W_total_air",0) for h in history)/len(history),
            "F_max_air":      sum(h.get("F_max_air",0)  for h in history)/len(history),
        }
    msg_data = build_user_message(result=result, medium=medium, version=version, lang=lang)
    if version == "pro" and user_avg:
        val     = cum_deg
        avg_val = user_avg.get("cumulative_deg", val)
        pct     = (val - avg_val) / avg_val * 100 if avg_val else 0
        if pct > 5:
            rank_msg   = {"en":"Congrats, You are excellent! 🥇","hu":"Gratulálok, kiváló vagy! 🥇"}.get(lang,"Congrats! 🥇")
            rank_medal = "gold"
        elif pct >= -5:
            rank_msg   = {"en":"Congrats, You are in good shape! 🥈","hu":"Gratulálok, jó formában vagy! 🥈"}.get(lang,"Good shape! 🥈")
            rank_medal = "silver"
        else:
            rank_msg   = {"en":"Congrats, your power works! 🥉","hu":"Gratulálok, az erőd működik! 🥉"}.get(lang,"Keep going! 🥉")
            rank_medal = "bronze"
        msg_data["rank_message"] = rank_msg
        msg_data["rank_medal"]   = rank_medal
        msg_data["pct_vs_avg"]   = round(pct, 1)
    # ── Group ranking (shown to all users) ────────────────────────────────
    if version == "pro":
        try:
            group_avg = get_group_averages()
            group_count = group_avg.get("count", 0)
            if group_count >= 2:
                g_avg_val = group_avg.get("cumulative_deg", 0)
                g_pct = (cum_deg - g_avg_val) / g_avg_val * 100 if g_avg_val else 0
                msg_data["group_intro"] = {
                    "en": f"Let's see your ranking among {group_count} people!",
                    "hu": f"Nézzük az eredményed {group_count} ember között!",
                }.get(lang, f"Let's see your ranking among {group_count} people!")
                if g_pct > 5:
                    msg_data["group_message"] = {
                        "en": "Congrats, this is above average! 🏆",
                        "hu": "Gratulálok, ez átlag feletti! 🏆",
                    }.get(lang, "Congrats, this is above average! 🏆")
                    msg_data["group_medal"] = "gold"
                elif g_pct >= -5:
                    msg_data["group_message"] = {
                        "en": "Congrats, Your result is great, only a few will beat you! 🥈",
                        "hu": "Gratulálok, nagyszerű eredmény, csak kevesen előznek meg! 🥈",
                    }.get(lang, "Great result! 🥈")
                    msg_data["group_medal"] = "silver"
                else:
                    msg_data["group_message"] = {
                        "en": "Congrats, You're not above average yet, but with practice you'll soon be! 🥉",
                        "hu": "Gratulálok, még nem vagy átlag felett, de gyakorlással hamarosan leszel! 🥉",
                    }.get(lang, "Keep going! 🥉")
                    msg_data["group_medal"] = "bronze"
                msg_data["pct_vs_group_avg"] = round(g_pct, 1)

                # ── Power comparison: weak / strong vs average power of all users ──
                # (client spec: below avg power = weak, at/above = strong)
                try:
                    avg_power = group_avg.get("P_peak_air", 0) or 0
                    my_power  = result.get("P_peak", 0) or result.get("p_peak_air", 0) or 0
                    if avg_power > 0 and my_power > 0:
                        msg_data["avg_power_W"]   = avg_power
                        msg_data["my_power_W"]    = my_power
                        if my_power < avg_power:
                            msg_data["power_class"]   = "low"
                            msg_data["power_verdict"] = {
                                "en": "Your power is below average — you are weaker.",
                                "hu": "Az erőd átlag alatti — gyengébb vagy.",
                            }.get(lang, "Your power is below average.")
                        else:
                            msg_data["power_class"]   = "high"
                            msg_data["power_verdict"] = {
                                "en": "Your power is at or above average — you are strong!",
                                "hu": "Az erőd átlagos vagy a feletti — erős vagy!",
                            }.get(lang, "Your power is at or above average — strong!")
                except Exception as _pe:
                    log.warning(f"[PHYSICS] power class: {_pe}")
        except Exception as e:
            log.warning(f"[PHYSICS] group ranking: {e}")

    if is_outlier:
        msg_data["warning"] = {"en":"Are you sure this result came out correctly? ⚠️",
                               "hu":"Biztos, hogy ez az eredmény helyes? ⚠️"}.get(lang,"Check result ⚠️")
    msg_data["t_lajtner_s"] = round(result.get("t_lajtner", 0), 3)
    msg_data["a_lajtner"]   = format_si(result.get("a_lajtner", 0), "rad/s³")
    now = datetime.datetime.utcnow().strftime("%Y-%m-%d %H:%M:%S")
    csv_row = build_csv_row(
        email=user_email, job_id=job_id, timestamp=now,
        sample_interval_ms=SAMPLE_INTERVAL_MS, medium=medium,
        phases=phases, result=result,
    )
    for _attempt in range(3):
        try:
            save_physics_result(job_id, user_email, medium, result, csv_row)
            log.info(f"[PHYSICS] Saved to DB: {job_id}")
            break
        except Exception as e:
            log.warning(f"[PHYSICS] save attempt {_attempt+1} failed: {e}")
            if _attempt == 2:
                log.error(f"[PHYSICS] All save attempts failed for {job_id}")
    return {"phases":phases,"result":result,"message":msg_data,"csv_row":csv_row,"is_outlier":is_outlier}


# ── Video file processing (seg model) ─────────────────────────────────────
def _process_video_seg(video_path, out_path, job_id="local",
                       direction="auto", medium="air",
                       progress_cb=None, watermark="", upload_dt=""):
    """Process uploaded video with seg model — draw mask + orange on each frame."""
    from app.detector_seg import draw_seg_overlay
    import time as _time

    cap = cv2.VideoCapture(video_path)
    if not cap.isOpened():
        raise RuntimeError(f"Cannot open: {video_path}")

    fps   = cap.get(cv2.CAP_PROP_FPS) or 30.0
    W     = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
    H     = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
    total = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))

    # Try H.264 (avc1) first for Android/Chrome compatibility
    fourcc  = cv2.VideoWriter_fourcc(*"avc1")
    out_vid = cv2.VideoWriter(str(out_path), fourcc, fps, (W, H + BAR_HEIGHT))
    if not out_vid.isOpened():
        log.warning("[VIDEO] avc1 failed, trying mp4v")
        fourcc  = cv2.VideoWriter_fourcc(*"mp4v")
        out_vid = cv2.VideoWriter(str(out_path), fourcc, fps, (W, H + BAR_HEIGHT))
    if not out_vid.isOpened():
        log.warning("[VIDEO] mp4v failed, trying XVID")
        fourcc  = cv2.VideoWriter_fourcc(*"XVID")
        out_vid = cv2.VideoWriter(str(out_path.with_suffix(".avi")), fourcc, fps, (W, H + BAR_HEIGHT))
    log.info(f"[VIDEO] writer opened={out_vid.isOpened()} path={out_path} size={W}x{H}+{BAR_HEIGHT} fps={fps:.1f}")

    stab        = Stabilizer()
    rot_prev    = None
    rot_cum     = 0.0
    rot_buf     = []
    zero_offset = None
    vel_dps     = 0.0
    last_ora    = None
    _last_mask  = None
    _last_hub     = None
    _last_contour = None
    _last_tips    = []
    _last_bbox        = None
    _last_yolo_orange = None

    sample_interval = 1.0 / SAMPLES_PER_SECOND
    next_sample_at  = 0.0
    all_samples     = []
    fi = 0

    while True:
        ret, frame = cap.read()
        if not ret: break

        t_sec   = fi / fps
        frame_s = frame  # no stabilizer for upload — use raw frame
        preproc = cv2.bilateralFilter(frame_s, 7, 50, 50)
        hsv     = cv2.cvtColor(preproc, cv2.COLOR_BGR2HSV)

        if fi % YOLO_EVERY == 0:
            _mask_d, _hub_d, _cont_d, _conf_d, _bbox_d, _yolo_ora_d = detect_seg(_seg, preproc)
            if _mask_d is not None:
                _last_mask       = _mask_d
                _last_hub        = _hub_d
                _last_contour    = _cont_d
                _last_tips       = find_spoke_tips(_mask_d, _hub_d)
                _last_bbox       = _bbox_d
            if _yolo_ora_d is not None:
                _last_yolo_orange = _yolo_ora_d

        hub      = _last_hub
        tips     = _last_tips
        contour  = _last_contour
        mask     = _last_mask
        bbox     = _last_bbox
        has_hub  = hub is not None

        # Priority 1: YOLO orange (class 1 from model)
        yolo_orange = _last_yolo_orange
        if yolo_orange is not None and has_hub:
            if tips:
                max_r = max(math.hypot(tx-hub[0], ty-hub[1]) for tx,ty in tips) * 1.2
                ora_dist = math.hypot(yolo_orange[0]-hub[0], yolo_orange[1]-hub[1])
                ora_blob = yolo_orange if ora_dist <= max_r else None
            else:
                ora_blob = yolo_orange
        else:
            ora_blob = None
        # Priority 2: HSV fallback
        if ora_blob is None and has_hub:
            ora_blob = find_orange_tip(hsv, tips, hub, last_ora)

        if ora_blob is not None:
            last_ora = ora_blob
            has_orange = True
        elif last_ora is not None:
            ora_blob = last_ora
            has_orange = True
        else:
            has_orange = False

        # Detect all tip colors for video overlay (controlled by DETECT_OTHER_COLORS)
        tip_colors = find_all_tip_colors(hsv, tips, hub) if (DETECT_OTHER_COLORS and has_hub and tips) else []

        rot_raw = None
        if has_hub and has_orange:
            rot_raw = orange_angle(ora_blob, hub)
        if rot_raw is not None and zero_offset is None:
            zero_offset = rot_raw
        # rot_z: signed angle relative to zero, range -180..+180
        if rot_raw is not None and zero_offset is not None:
            rot_z = rot_raw - zero_offset
            # Normalize to -180..+180
            if rot_z >  180: rot_z -= 360
            if rot_z < -180: rot_z += 360
        else:
            rot_z = None
        # Reject angle jumps > MAX_ANGLE_JUMP (spoke-hopping filter)
        if rot_z is not None and rot_buf:
            diff = rot_z - rot_buf[-1]
            if diff >  180: diff -= 360
            if diff < -180: diff += 360
            if abs(diff) > MAX_ANGLE_JUMP:
                rot_z = None  # reject this measurement
        if rot_z is not None:
            rot_buf.append(rot_z)
            if len(rot_buf) > SEG_SMOOTH_N: rot_buf.pop(0)
            # Signed smooth angle (no % 360 — preserve sign for CW/CCW)
            rot_smooth = math.degrees(math.atan2(
                np.mean([math.sin(math.radians(x)) for x in rot_buf]),
                np.mean([math.cos(math.radians(x)) for x in rot_buf])))
        else:
            rot_smooth = rot_buf[-1] if rot_buf else None
        if rot_smooth is not None:
            if rot_prev is not None:
                rot_cum = unwrap(rot_prev, rot_smooth, rot_cum)
            rot_prev = rot_smooth
        if len(rot_buf) >= 2:
            d = rot_buf[-1] - rot_buf[-2]
            if d >  180: d -= 360
            if d < -180: d += 360
            vel_dps = d * fps

        # Confidence
        conf_disp = 100 if has_orange else (60 if has_hub else 0)

        # Draw
        ann = frame_s.copy()
        draw_seg_overlay(ann, mask, hub, contour, tips, ora_blob, rot_smooth, rot_cum, bbox, tip_colors=tip_colors, draw_mesh=DRAW_MESH_OVERLAY)


        # Draw info bar below frame
        bar = np.full((BAR_HEIGHT, W, 3), (18, 18, 18), np.uint8)
        cv2.line(bar, (0, 0), (W, 0), (55, 55, 55), 1)
        # Time, rotation, cumulative, velocity, confidence
        GREEN  = (0, 255, 128); WHITE = (230, 230, 230)
        GRAY   = (120, 120, 120); YELLOW = (0, 220, 220)
        rot_s  = f"{rot_smooth:.1f}" if rot_smooth is not None else "---"
        cum_s  = f"{-rot_cum:+.1f}"
        vel_s  = f"{-vel_dps:+.1f}" if vel_dps else "0.0"
        conf_c = (40,200,40) if conf_disp>=80 else ((0,200,220) if conf_disp>=50 else (40,40,220))
        t_s    = f"{t_sec:.2f} s"
        col1, col2, col3 = 14, W//3, 2*W//3
        # Time
        cv2.putText(bar,"TIME",(col1,22),cv2.FONT_HERSHEY_SIMPLEX,0.38,GRAY,1)
        cv2.putText(bar,t_s,(col1,50),cv2.FONT_HERSHEY_SIMPLEX,0.85,WHITE,2,cv2.LINE_AA)
        # Rotation
        cv2.putText(bar,"ROTATION",(col1,78),cv2.FONT_HERSHEY_SIMPLEX,0.38,GRAY,1)
        cv2.putText(bar,rot_s,(col1,108),cv2.FONT_HERSHEY_SIMPLEX,0.95,YELLOW,2,cv2.LINE_AA)
        cv2.putText(bar,"deg",(col1+90,108),cv2.FONT_HERSHEY_SIMPLEX,0.50,YELLOW,1)
        # Cumulative
        cv2.putText(bar,"TOTAL",(col1,150),cv2.FONT_HERSHEY_SIMPLEX,0.38,GRAY,1)
        cv2.putText(bar,cum_s,(col1,192),cv2.FONT_HERSHEY_SIMPLEX,1.25,GREEN,3,cv2.LINE_AA)
        cv2.putText(bar,"deg",(col1+130,192),cv2.FONT_HERSHEY_SIMPLEX,0.55,GREEN,2)
        cv2.putText(bar,f"vel: {vel_s} deg/s",(col1,228),cv2.FONT_HERSHEY_SIMPLEX,0.38,GRAY,1)
        # Confidence
        cv2.putText(bar,"SIGNIFICANCE",(col2,22),cv2.FONT_HERSHEY_SIMPLEX,0.38,GRAY,1)
        cv2.putText(bar,f"{conf_disp}%",(col2,68),cv2.FONT_HERSHEY_SIMPLEX,1.15,conf_c,2,cv2.LINE_AA)
        bw = col3 - col2 - 20
        cv2.rectangle(bar,(col2,76),(col2+bw,92),(40,40,40),-1)
        fw = int(bw * conf_disp / 100)
        if fw > 0: cv2.rectangle(bar,(col2,76),(col2+fw,92),conf_c,-1)
        cv2.rectangle(bar,(col2,76),(col2+bw,92),(70,70,70),1)
        # Source + Medium
        if hub is not None:
            cv2.putText(bar,"Hub: SEG",(col2,118),cv2.FONT_HERSHEY_SIMPLEX,0.40,WHITE,1)
        med_str = (medium or "air").upper()
        med_col = (200,180,100) if med_str == "WATER" else (180,180,180)
        cv2.putText(bar, med_str, (col2, 148), cv2.FONT_HERSHEY_SIMPLEX, 0.55, med_col, 1, cv2.LINE_AA)
        # Dial
        dcx = col3 + (W-col3)//2; dcy = 100; dr = 68
        cv2.circle(bar,(dcx,dcy),dr,(45,45,45),-1)
        cv2.circle(bar,(dcx,dcy),dr,(80,80,80),1)
        cv2.putText(bar,"+",(dcx-dr+4,dcy-dr+14),cv2.FONT_HERSHEY_SIMPLEX,0.40,(80,200,80),1)
        cv2.putText(bar,"-",(dcx+dr-14,dcy-dr+14),cv2.FONT_HERSHEY_SIMPLEX,0.40,(80,80,200),1)
        cv2.line(bar,(dcx,dcy-dr),(dcx,dcy-dr+8),(90,90,90),1)
        if rot_smooth is not None:
            rad_a = math.radians(rot_smooth)
            ncol  = (40,200,40) if rot_cum<=0 else (40,40,200)
            cv2.line(bar,(dcx,dcy),(int(dcx+(dr-10)*math.sin(rad_a)),
                     int(dcy-(dr-10)*math.cos(rad_a))),ncol,2,cv2.LINE_AA)
        cv2.circle(bar,(dcx,dcy),4,conf_c,-1)
        cv2.putText(bar,f"{rot_smooth:.1f} deg" if rot_smooth else "---",
                    (dcx-32,dcy+dr+18),cv2.FONT_HERSHEY_SIMPLEX,0.46,conf_c,1,cv2.LINE_AA)
        # Watermark


        # Watermark - top right corner of video frame
        _wm = WATERMARK_TEXT
        _wm_scale = max(0.6, W / 1000.0)
        _wm_thick = max(2, int(W / 500))
        (wm_w, wm_h), _ = cv2.getTextSize(_wm, cv2.FONT_HERSHEY_SIMPLEX, _wm_scale, _wm_thick)
        _wx = ann.shape[1] - wm_w - 12
        _wy = wm_h + 12
        # Shadow
        cv2.putText(ann, _wm, (_wx + 2, _wy + 2), cv2.FONT_HERSHEY_SIMPLEX,
                    _wm_scale, (0, 0, 0), _wm_thick + 2, cv2.LINE_AA)
        # White text
        cv2.putText(ann, _wm, (_wx, _wy), cv2.FONT_HERSHEY_SIMPLEX,
                    _wm_scale, (255, 255, 255), _wm_thick, cv2.LINE_AA)
        # Write frame + bar
        if ann.shape[1] != W or ann.shape[0] != H:
            ann = cv2.resize(ann, (W, H))
        out_vid.write(np.vstack([ann, bar]))

        # Sample
        if t_sec >= next_sample_at:
            conf_disp = 100 if has_orange else (60 if has_hub else 0)
            # rotation_deg: signed current spoke position (CW=neg, CCW=pos)
            # cumulative_deg: signed running total (CW=neg, CCW=pos)
            all_samples.append(make_sample(
                job_id=job_id, timestamp_sec=t_sec,
                rotation_deg=round(rot_smooth, 2) if rot_smooth is not None else None,
                cumulative_deg=-rot_cum,
                angular_vel_dps=-vel_dps, confidence_pct=conf_disp, source="SEG",
            ))
            next_sample_at += sample_interval
            if len(all_samples) % 20 == 0:
                persist_samples(job_id, all_samples[-20:])

        if progress_cb:
            pct = int(fi / total * 100) if total > 0 else 0
            progress_cb({
                "frame": fi, "total": total, "pct": pct,
                "t_sec": round(t_sec, 2), "total_sec": round(total/fps, 2) if fps > 0 else 0, "vid_w": W, "vid_h": H,
                "hub": [round(hub[0]), round(hub[1])] if hub else None,
                "orange": [ora_blob[0], ora_blob[1], ora_blob[4]] if ora_blob else None,
                "no_ground": hub is None,
                "no_orange": not has_orange,
                "rotation_deg": round(abs(rot_smooth) % 360, 1) if rot_smooth else None,
                "cumulative_deg": round(-rot_cum, 1),
                "angular_vel_dps": round(-vel_dps, 1) if vel_dps else 0.0,
                "confidence_pct": 100 if has_orange else (60 if has_hub else 0),
            })
        fi += 1

    cap.release()

    # LR overlay added later after physics (see add_lr_overlay_to_video)
    planck_freq_val = None  # placeholder

    # Add Lajtner Resonance overlay on last 3 seconds of video
    try:
        if planck_freq_val and planck_freq_val > 0:
            import math as _math
            exp = int(_math.floor(_math.log10(abs(planck_freq_val))))
            mant = planck_freq_val / (10 ** exp)
            lr_str = f"Lajtner Resonance: {mant:.2f}L {exp:+d}R"
            # Re-open video to add overlay on last frames
            out_vid.release()
            _tmp_lr = out_path + ".lr.mp4" if isinstance(out_path, str) else str(out_path) + ".lr.mp4"
            cap2 = cv2.VideoCapture(str(out_path))
            total_frames2 = int(cap2.get(cv2.CAP_PROP_FRAME_COUNT))
            fps2 = cap2.get(cv2.CAP_PROP_FPS) or fps
            W2 = int(cap2.get(cv2.CAP_PROP_FRAME_WIDTH))
            H2 = int(cap2.get(cv2.CAP_PROP_FRAME_HEIGHT))
            last_n = int(fps2 * 3)  # last 3 seconds
            fourcc2 = cv2.VideoWriter_fourcc(*"mp4v")
            out2 = cv2.VideoWriter(_tmp_lr, fourcc2, fps2, (W2, H2))
            fi = 0
            while True:
                ret2, frm2 = cap2.read()
                if not ret2: break
                if fi >= total_frames2 - last_n:
                    # Dark overlay background
                    overlay = frm2.copy()
                    cv2.rectangle(overlay, (0, H2//2 - 60), (W2, H2//2 + 60), (0,0,0), -1)
                    cv2.addWeighted(overlay, 0.6, frm2, 0.4, 0, frm2)
                    # LR text
                    scale = max(0.7, W2/800)
                    thick = max(2, int(W2/400))
                    (tw, th), _ = cv2.getTextSize(lr_str, cv2.FONT_HERSHEY_SIMPLEX, scale, thick)
                    tx = (W2 - tw) // 2
                    ty = H2 // 2 + th // 2
                    cv2.putText(frm2, lr_str, (tx, ty),
                        cv2.FONT_HERSHEY_SIMPLEX, scale, (0,0,0), thick+2, cv2.LINE_AA)
                    cv2.putText(frm2, lr_str, (tx, ty),
                        cv2.FONT_HERSHEY_SIMPLEX, scale, (255,165,0), thick, cv2.LINE_AA)
                    # subtitle
                    sub = "based on Planck constant"
                    (sw, sh), _ = cv2.getTextSize(sub, cv2.FONT_HERSHEY_SIMPLEX, scale*0.55, 1)
                    cv2.putText(frm2, sub, ((W2-sw)//2, ty + th + 12),
                        cv2.FONT_HERSHEY_SIMPLEX, scale*0.55, (200,200,200), 1, cv2.LINE_AA)
                out2.write(frm2)
                fi += 1
            cap2.release()
            out2.release()
            import shutil as _sh2
            _sh2.move(_tmp_lr, str(out_path))
            log.info(f"[VIDEO] Lajtner Resonance overlay added: {lr_str}")
    except Exception as _e:
        log.warning(f"[VIDEO] LR overlay failed: {_e}")
        try: out_vid.release()
        except: pass
    else:
        out_vid.release()

    # Re-encode to H.264 for Android/Chrome compatibility using imageio
    try:
        import imageio
        from pathlib import Path as _Path
        _op = _Path(out_path)
        _tmp = _op.with_suffix(".tmp.mp4")
        # Read all frames from OpenCV output
        reader = imageio.get_reader(str(_op))
        _meta = reader.get_meta_data()
        _fps_out = _meta.get('fps', fps)
        writer = imageio.get_writer(
            str(_tmp),
            fps=_fps_out,
            codec='libx264',
            quality=7,
            macro_block_size=16,
            ffmpeg_params=['-movflags', '+faststart', '-pix_fmt', 'yuv420p']
        )
        for frame in reader:
            writer.append_data(frame)
        reader.close()
        writer.close()
        if _tmp.exists() and _tmp.stat().st_size > 1000:
            _tmp.replace(_op)
            log.info(f"[VIDEO] Re-encoded to H.264 via imageio: {_op}")
        else:
            if _tmp.exists(): _tmp.unlink()
    except Exception as _e:
        log.warning(f"[VIDEO] imageio re-encode failed: {_e}")

    # Sort by timestamp to fix out-of-order frames
    all_samples.sort(key=lambda s: s["timestamp_sec"])
    rem = len(all_samples) % 20
    if rem: persist_samples(job_id, all_samples[-rem:])
    log.info(f"[VIDEO] done — {len(all_samples)} samples → {out_path}")
    return all_samples

# ── Upload pipeline ────────────────────────────────────────────────────────
def _clear_samples(job_id: str):
    """Delete all existing samples for a job (CSV + Supabase) before reprocessing."""
    from app.database import CSV_DIR, TABLE_SAMPLES
    csv_path = CSV_DIR / f"{job_id}.csv"
    if csv_path.exists():
        csv_path.unlink()
        log.info(f"[JOB] cleared CSV samples: {job_id}")
    try:
        from app.database import _sb
        sb = _sb()
        if sb:
            sb.table(TABLE_SAMPLES).delete().eq("job_id", job_id).execute()
            log.info(f"[JOB] cleared Supabase samples: {job_id}")
    except Exception as e:
        log.warning(f"[JOB] clear samples failed: {e}")

def _run_job(job_id, raw_path, direction, medium, hand_visible,
             info_level, user_email, version, lang):
    try:
        jobs[job_id]["status"]   = "preprocessing"
        jobs[job_id]["progress"] = {"pct":0,"frame":0,"total":0}
        # Remove old samples CSV to avoid duplicates from stream pre-detection
        old_csv = get_csv_path(job_id)
        if old_csv.exists():
            old_csv.unlink()
            log.info(f"[JOB] cleared old samples CSV: {old_csv}")
        # Clear old samples from stream phase before reprocessing
        _clear_samples(job_id)
        upload_dt = datetime.datetime.utcnow().strftime("%Y.%m.%d.%H.%M")
        if PREPROCESS_ENABLED:
            prep = INPUTS_DIR / f"{job_id}_prep.mp4"
            preprocess_video(raw_path, prep)
        else:
            prep = raw_path
        jobs[job_id]["status"] = "processing"
        out = OUTPUTS_DIR / f"{job_id}_tracked.mp4"
        def on_progress(data):
            jobs[job_id]["progress"] = data
        samples = _process_video_seg(
            str(prep), str(out), job_id=job_id,
            direction=direction, medium=medium,
            progress_cb=on_progress,
            watermark=WATERMARK_TEXT, upload_dt=upload_dt,
        )
        jobs[job_id]["status"] = "calculating"
        physics = _run_physics(samples or [], medium, direction, user_email, job_id, version, lang)
        # Add Lajtner Resonance overlay to video after physics
        try:
            _planck = physics.get("result",{}).get("air",{}).get("planck_freq", 0) or                       physics.get("result",{}).get("ideal",{}).get("planck_freq", 0)
            if _planck and _planck > 0:
                add_lr_overlay(str(out), _planck)
        except Exception as _e:
            log.warning(f"[VIDEO] LR overlay call failed: {_e}")
        finish_job(job_id, len(samples) if samples else 0,
                   samples[-1]["timestamp_sec"] if samples else 0)
        jobs[job_id] = {
            "status":"done", "filename":out.name,
            "sample_count":len(samples) if samples else 0,
            "url":f"/download/{job_id}", "csv_url":f"/csv/{job_id}",
            "results_url":f"/results/{job_id}", "physics_url":f"/physics/{job_id}",
            "message":physics.get("message",{}), "physics":physics.get("result",{}),
            "phases":physics.get("phases",{}), "progress":{"pct":100},
        }
        log.info(f"[{job_id}] done — {len(samples) if samples else 0} samples")
    except Exception as exc:
        log.error(f"[{job_id}] failed: {exc}", exc_info=True)
        jobs[job_id] = {"status":"error","detail":str(exc)}

# ── Auth ──────────────────────────────────────────────────────────────────
# SQL: CREATE TABLE IF NOT EXISTS wt_users (
#   email TEXT PRIMARY KEY, password_hash TEXT, created_at TEXT
# );

def _hash_pw(pw: str) -> str:
    return hashlib.sha256(pw.encode()).hexdigest()

def _get_user(email: str):
    try:
        from app.database import _sb
        sb = _sb()
        if not sb: return None
        r = sb.table("wt_users").select("*").eq("email", email).limit(1).execute()
        return r.data[0] if r.data else None
    except: return None



# ── Stripe payment integration ─────────────────────────────────────────────
STRIPE_SECRET_KEY     = os.environ.get("STRIPE_SECRET_KEY", "")
STRIPE_WEBHOOK_SECRET = os.environ.get("STRIPE_WEBHOOK_SECRET", "")
STRIPE_PRICE_ID       = os.environ.get("STRIPE_PRICE_ID", "")  # monthly Pro price

@app.post("/stripe/create-checkout")
async def stripe_create_checkout(request: Request):
    """Create Stripe checkout session for Pro plan."""
    if not STRIPE_SECRET_KEY:
        raise HTTPException(503, "Stripe not configured")
    body = await request.json()
    email = (body.get("email") or "").strip().lower()
    if not email:
        raise HTTPException(400, "Email required")
    try:
        import stripe
        stripe.api_key = STRIPE_SECRET_KEY
        session = stripe.checkout.Session.create(
            payment_method_types=["card"],
            mode="subscription",
            customer_email=email,
            line_items=[{"price": STRIPE_PRICE_ID, "quantity": 1}],
            success_url=body.get("success_url", "https://enyem.com/subscription?success=1"),
            cancel_url=body.get("cancel_url",  "https://enyem.com/subscription?cancelled=1"),
            metadata={"user_email": email},
        )
        return {"url": session.url, "session_id": session.id}
    except Exception as e:
        log.error(f"[STRIPE] checkout error: {e}")
        raise HTTPException(500, str(e))

@app.get("/stripe/check-session")
async def stripe_check_session(session_id: str = "", email: str = ""):
    """After successful payment - verify session and update plan."""
    if not STRIPE_SECRET_KEY or not session_id:
        raise HTTPException(400, "Missing params")
    try:
        import stripe
        stripe.api_key = STRIPE_SECRET_KEY
        session = stripe.checkout.Session.retrieve(session_id)
        status = getattr(session, "payment_status", "")
        sub_status = getattr(session, "status", "")
        if status == "pro" or sub_status == "complete":
            cust_email = getattr(session, "customer_email", "") or email
            if cust_email:
                from app.database import _sb
                sb = _sb()
                sb.table("wt_users").update({"plan":"pro"}).eq("email", cust_email.lower()).execute()
                log.info(f"[STRIPE] plan updated via check-session for {cust_email}")
            return {"ok": True, "plan": "pro", "status": sub_status}
        return {"ok": False, "status": sub_status}
    except Exception as e:
        raise HTTPException(500, str(e))

@app.get("/stripe/webhook")
async def stripe_webhook_get():
    return {"ok": True}

@app.post("/stripe/webhook")
async def stripe_webhook(request: Request):
    """Handle Stripe webhook events."""
    if not STRIPE_SECRET_KEY:
        raise HTTPException(503, "Stripe not configured")
    payload    = await request.body()  # raw bytes — must not be parsed before
    sig_header = request.headers.get("stripe-signature", "")
    log.info(f"[STRIPE] webhook sig={sig_header[:40]}... secret_set={bool(STRIPE_WEBHOOK_SECRET)}")
    if not STRIPE_WEBHOOK_SECRET:
        # No webhook secret — parse event directly (dev mode only)
        import json as _json
        event = _json.loads(payload)
        log.warning("[STRIPE] webhook secret not set — skipping signature verification")
    else:
        try:
            import stripe
            stripe.api_key = STRIPE_SECRET_KEY
            event = stripe.Webhook.construct_event(
                payload, sig_header, STRIPE_WEBHOOK_SECRET
            )
        except Exception as e:
            log.warning(f"[STRIPE] webhook verify failed: {e}")
            raise HTTPException(400, str(e))

    evt = event["type"]
    log.info(f"[STRIPE] event: {evt}")

    if evt in ("checkout.session.completed", "customer.subscription.created",
               "invoice.paid"):
        obj = event["data"]["object"]
        # Numbered-unit purchase (Pioneer/Founder/Alpha) → finalize allocation
        try:
            meta = getattr(obj, "metadata", {}) or {}
            mget = (lambda k: meta.get(k) if isinstance(meta, dict) else getattr(meta, k, None))
            if mget("kind") == "unit":
                _finalize_unit(mget("series") or "pioneer",
                               int(mget("number") or 0),
                               (mget("email") or "").lower(),
                               mget("name") or "")
                return {"ok": True}
        except Exception as e:
            log.error(f"[STRIPE] unit finalize failed: {e}")
            email = getattr(obj, "customer_email", None) or ""
        except Exception:
            email = ""
        if not email:
            try:
                meta = getattr(obj, "metadata", {})
                email = (meta.get("user_email") if isinstance(meta, dict)
                         else getattr(meta, "user_email", "")) or ""
            except Exception:
                email = ""
        if not email:
            try:
                cust_id = getattr(obj, "customer", None)
                if cust_id:
                    cust  = stripe.Customer.retrieve(cust_id)
                    email = getattr(cust, "email", "") or ""
            except Exception:
                pass
        if email:
            try:
                from app.database import _sb
                sb = _sb()
                sb.table("wt_users").update({"plan": "pro"}).eq("email", email.lower()).execute()
                log.info(f"[STRIPE] upgraded {email} to paid")
            except Exception as e:
                log.error(f"[STRIPE] db update failed: {e}")

    elif evt in ("customer.subscription.deleted", "customer.subscription.paused"):
        obj = event["data"]["object"]
        try:
            cust_id = getattr(obj, "customer", None)
            cust  = stripe.Customer.retrieve(cust_id)
            email = getattr(cust, "email", "") or ""
        except Exception:
            email = ""
        if email:
            try:
                from app.database import _sb
                sb = _sb()
                sb.table("wt_users").update({"plan": "basic"}).eq("email", email.lower()).execute()
                log.info(f"[STRIPE] downgraded {email} to free")
            except Exception as e:
                log.error(f"[STRIPE] db update failed: {e}")

    return {"ok": True}

@app.post("/stripe/cancel")
async def stripe_cancel(request: Request):
    """Cancel subscription."""
    if not STRIPE_SECRET_KEY:
        raise HTTPException(503, "Stripe not configured")
    body = await request.json()
    email = (body.get("email") or "").strip().lower()
    try:
        import stripe
        stripe.api_key = STRIPE_SECRET_KEY
        customers = stripe.Customer.list(email=email, limit=1)
        if not customers.data:
            raise HTTPException(404, "No Stripe customer found")
        cust_id = customers.data[0].id
        subs = stripe.Subscription.list(customer=cust_id, status="active", limit=1)
        if not subs.data:
            raise HTTPException(404, "No active subscription found")
        stripe.Subscription.cancel(subs.data[0].id)
        from app.database import _sb
        sb = _sb()
        sb.table("wt_users").update({"plan": "basic"}).eq("email", email).execute()
        return {"ok": True, "message": "Subscription cancelled"}
    except HTTPException: raise
    except Exception as e:
        raise HTTPException(500, str(e))

# ── Password reset ─────────────────────────────────────────────────────────
import random

_reset_codes: dict = {}  # email -> {code, expires}

@app.post("/auth/reset-request")
async def reset_request(request: Request):
    body = await request.json()
    email = (body.get("email") or "").strip().lower()
    if not email:
        raise HTTPException(400, "Email required")
    user = _get_user(email)
    if not user:
        # Don't reveal if email exists
        return {"ok": True}
    code = str(random.randint(100000, 999999))
    import datetime as _dt
    _reset_codes[email] = {
        "code": code,
        "expires": _dt.datetime.utcnow().timestamp() + 900  # 15 min
    }
    log.info(f"[RESET] code for {email}: {code}")
    # Send email via Gmail SMTP
    import smtplib
    from email.mime.text import MIMEText
    from email.mime.multipart import MIMEMultipart
    GMAIL_USER = os.environ.get("GMAIL_USER", "")   # your@gmail.com
    GMAIL_PASS = os.environ.get("GMAIL_PASS", "")   # Gmail App Password (not account password)
    if GMAIL_USER and GMAIL_PASS:
        try:
            msg = MIMEMultipart("alternative")
            msg["Subject"] = "Wheel Tracker — Password Reset Code"
            msg["From"]    = f"Wheel Tracker <{GMAIL_USER}>"
            msg["To"]      = email
            body_text = f"Your password reset code: {code}\n\nValid for 15 minutes.\n\nIf you did not request this, ignore this email."
            body_html = f"""<div style="font-family:sans-serif;max-width:480px;margin:40px auto;background:#0d1117;color:#e2e8f0;border-radius:12px;padding:32px;border:1px solid #1e2a38">
  <h2 style="color:#00ff88;margin-bottom:8px">Wheel Tracker</h2>
  <p style="color:#64748b;margin-bottom:24px">Password reset request</p>
  <div style="background:#141a22;border-radius:10px;padding:24px;text-align:center;margin-bottom:24px">
    <div style="font-size:2.5rem;font-weight:700;letter-spacing:.4em;color:#00ff88;font-family:monospace">{code}</div>
    <div style="color:#64748b;font-size:.85rem;margin-top:8px">Valid for 15 minutes</div>
  </div>
  <p style="color:#64748b;font-size:.82rem">If you did not request this, ignore this email.</p>
</div>"""
            msg.attach(MIMEText(body_text, "plain"))
            msg.attach(MIMEText(body_html, "html"))
            with smtplib.SMTP_SSL("smtp.gmail.com", 465) as s:
                s.login(GMAIL_USER, GMAIL_PASS)
                s.sendmail(GMAIL_USER, email, msg.as_string())
            log.info(f"[RESET] email sent to {email}")
        except Exception as e:
            log.error(f"[RESET] email send failed: {e}")
            raise HTTPException(500, f"Failed to send email: {e}")
    else:
        log.warning("[RESET] GMAIL_USER/GMAIL_PASS not set — code logged only")
    return {"ok": True}

@app.post("/auth/reset-confirm")
async def reset_confirm(request: Request):
    body = await request.json()
    email    = (body.get("email") or "").strip().lower()
    code     = (body.get("code") or "").strip()
    password = body.get("password") or ""
    if not email or not code or not password:
        raise HTTPException(400, "Email, code and password required")
    import datetime as _dt
    entry = _reset_codes.get(email)
    if not entry:
        raise HTTPException(400, "No reset requested for this email")
    if _dt.datetime.utcnow().timestamp() > entry["expires"]:
        del _reset_codes[email]
        raise HTTPException(400, "Code expired — request a new one")
    if entry["code"] != code:
        raise HTTPException(400, "Invalid code")
    # Update password
    try:
        from app.database import _sb
        sb = _sb()
        sb.table("wt_users").update({"password_hash": _hash_pw(password)}).eq("email", email).execute()
        del _reset_codes[email]
        return {"ok": True}
    except Exception as e:
        raise HTTPException(500, str(e))

@app.post("/auth/register")
async def auth_register(request: Request):
    body = await request.json()
    email = (body.get("email") or "").strip().lower()
    password = body.get("password") or ""
    recaptcha_token = body.get("recaptcha_token") or ""
    if not email or not password:
        raise HTTPException(400, "Email and password required")
    if not await _verify_recaptcha(recaptcha_token):
        raise HTTPException(400, "reCAPTCHA verification failed. Please try again.")
    if _get_user(email):
        raise HTTPException(409, "Email already registered")
    try:
        from app.database import _sb
        sb = _sb()
        sb.table("wt_users").insert({
            "email": email,
            "password_hash": _hash_pw(password),
            "plan": "basic",
            "created_at": datetime.datetime.utcnow().isoformat(),
        }).execute()
        return {"ok": True}
    except Exception as e:
        raise HTTPException(500, str(e))

@app.post("/auth/plan")
async def auth_update_plan(request: Request):
    body = await request.json()
    email = (body.get("email") or "").strip().lower()
    plan  = (body.get("plan") or "basic").strip().lower()
    if plan not in ("basic", "pro"):
        raise HTTPException(400, "Invalid plan")
    if not email:
        raise HTTPException(400, "Email required")
    try:
        from app.database import _sb
        sb = _sb()
        if not sb:
            raise HTTPException(500, "DB unavailable")
        sb.table("wt_users").update({"plan": plan}).eq("email", email).execute()
        return {"ok": True, "plan": plan}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(500, str(e))

@app.post("/auth/login")
async def auth_login(request: Request):
    body = await request.json()
    email = (body.get("email") or "").strip().lower()
    password = body.get("password") or ""
    recaptcha_token = body.get("recaptcha_token") or ""
    if not await _verify_recaptcha(recaptcha_token):
        raise HTTPException(400, "reCAPTCHA verification failed. Please try again.")
    user = _get_user(email)
    if not user or user.get("password_hash") != _hash_pw(password):
        raise HTTPException(401, "Invalid email or password")
    if user.get("blocked"):
        raise HTTPException(403, "This account has been suspended.")
    token = secrets.token_hex(32)
    return {"token": token, "email": email, "plan": user.get("plan", "basic")}

def add_lr_overlay(video_path: str, planck_freq: float):
    """Add Lajtner Resonance text to last 3 seconds of video."""
    import math as _math
    try:
        exp = int(_math.floor(_math.log10(abs(planck_freq))))
        mant = planck_freq / (10 ** exp)
        lr_str = f"Lajtner Resonance: {mant:.2f}L {exp:+d}R"
        _tmp = video_path + ".lr.mp4"
        cap = cv2.VideoCapture(video_path)
        total = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
        fps2 = cap.get(cv2.CAP_PROP_FPS) or 25.0
        W = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
        H = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
        last_n = int(fps2 * 3)
        fourcc = cv2.VideoWriter_fourcc(*"mp4v")
        out = cv2.VideoWriter(_tmp, fourcc, fps2, (W, H))
        fi = 0
        while True:
            ret, frm = cap.read()
            if not ret: break
            if fi >= total - last_n:
                overlay = frm.copy()
                cv2.rectangle(overlay, (0, H//2-65), (W, H//2+65), (0,0,0), -1)
                cv2.addWeighted(overlay, 0.65, frm, 0.35, 0, frm)
                scale = max(0.65, W/900)
                thick = max(2, int(W/450))
                (tw, th), _ = cv2.getTextSize(lr_str, cv2.FONT_HERSHEY_SIMPLEX, scale, thick)
                tx, ty = (W-tw)//2, H//2 + th//2
                cv2.putText(frm, lr_str, (tx, ty), cv2.FONT_HERSHEY_SIMPLEX, scale, (0,0,0), thick+2, cv2.LINE_AA)
                cv2.putText(frm, lr_str, (tx, ty), cv2.FONT_HERSHEY_SIMPLEX, scale, (255,165,0), thick, cv2.LINE_AA)
                sub = "based on Planck constant"
                (sw, _), _ = cv2.getTextSize(sub, cv2.FONT_HERSHEY_SIMPLEX, scale*0.5, 1)
                cv2.putText(frm, sub, ((W-sw)//2, ty+th+14), cv2.FONT_HERSHEY_SIMPLEX, scale*0.5, (200,200,200), 1, cv2.LINE_AA)
            out.write(frm)
            fi += 1
        cap.release(); out.release()
        import shutil as _sh; _sh.move(_tmp, video_path)
        log.info(f"[VIDEO] LR overlay: {lr_str}")
    except Exception as e:
        log.warning(f"[VIDEO] LR overlay failed: {e}")


@app.post("/upload")
async def upload(
    file:         UploadFile = File(...),
    user_email:   str  = Form(default=""),
    direction:    str  = Form(default=DEFAULT_DIRECTION),
    medium:       str  = Form(default=DEFAULT_MEDIUM),
    hand_visible: bool = Form(default=DEFAULT_HAND),
    info_level:   str  = Form(default=DEFAULT_INFO_LEVEL),
    version:      str  = Form(default=DEFAULT_VERSION),
    lang:         str  = Form(default=DEFAULT_LANG),
):
    suffix = Path(file.filename).suffix.lower()
    if suffix not in (".mp4",".avi",".mov",".mkv",".webm"):
        raise HTTPException(400, f"Unsupported: {suffix}")
    job_id   = str(uuid.uuid4())
    raw_path = INPUTS_DIR / f"{job_id}{suffix}"
    with open(raw_path,"wb") as f:
        shutil.copyfileobj(file.file, f)
    info = get_video_info(raw_path)
    # Master always gets Pro features regardless of plan
    if _is_master(user_email):
        version = "pro"
    create_job(job_id, user_email, "upload", direction, medium, hand_visible, info_level)
    jobs[job_id] = {"status":"queued","progress":{"pct":0},
                    "user_email": user_email,
                    "source_type": "upload",
                    "created_at": datetime.datetime.utcnow().isoformat()}
    asyncio.get_event_loop().run_in_executor(
        executor, _run_job, job_id, raw_path,
        direction, medium, hand_visible, info_level, user_email, version, lang)
    return {"job_id":job_id,"status":"queued",
            "status_url":f"/status/{job_id}","video_info":info}

@app.get("/status/{job_id}")
def status(job_id: str):
    info = jobs.get(job_id)
    if not info: raise HTTPException(404,"Not found")
    return {k:v for k,v in info.items() if k!="progress"}

@app.get("/progress/{job_id}")
def progress(job_id: str):
    info = jobs.get(job_id)
    if not info: raise HTTPException(404,"Not found")
    return {"status":info.get("status"),"progress":info.get("progress",{})}

@app.get("/frames/{job_id}")
async def frames_sse(job_id: str):
    async def gen():
        last_frame = -1
        while True:
            info = jobs.get(job_id)
            if not info:
                yield f"data: {json.dumps({'error':'not found'})}\n\n"; break
            p  = info.get("progress", {})
            fi = p.get("frame", -1)
            if fi != last_frame and fi >= 0:
                last_frame = fi
                yield f"data: {json.dumps(p)}\n\n"
            st = info.get("status")
            if st in ("done","error"):
                yield f"data: {json.dumps({'status':st,'done':True})}\n\n"; break
            await asyncio.sleep(0.05)
    return StreamingResponse(gen(), media_type="text/event-stream",
        headers={"Cache-Control":"no-cache","X-Accel-Buffering":"no",
                 "Access-Control-Allow-Origin":"*"})

@app.get("/download/{job_id}")
def download(job_id: str):
    info = jobs.get(job_id, {})
    # Try memory filename first
    if info.get("filename"):
        p = OUTPUTS_DIR / info["filename"]
        if p.exists():
            return FileResponse(str(p), media_type="video/mp4", filename=p.name)
    # Search outputs dir for tracked or stream file
    for suffix in ("_tracked.mp4", "_stream.mp4"):
        p = OUTPUTS_DIR / f"{job_id}{suffix}"
        if p.exists():
            return FileResponse(str(p), media_type="video/mp4", filename=p.name)
    raise HTTPException(404, "Video not found")

@app.get("/results/{job_id}")
def results(job_id: str): return read_samples(job_id)

@app.get("/physics/{job_id}")
def physics_results(job_id: str):
    # 1. Try memory first (fast, available right after processing)
    info = jobs.get(job_id, {})
    if info.get("physics") or info.get("message"):
        return {"message": info.get("message", {}),
                "result":  info.get("physics",  {}),
                "phases":  info.get("phases",   {}),
                "physics_url": f"/physics/{job_id}"}
    # 2. Always fallback to Supabase (persists across restarts)
    try:
        from app.database import _sb
        sb = _sb()
        if sb:
            resp = sb.table("physics_results").select(
                "physics_json, t_lajtner, a_lajtner"
            ).eq("job_id", job_id).limit(1).execute()
            if resp.data:
                row  = resp.data[0]
                phys = json.loads(row.get("physics_json") or "{}")
                # Rebuild message from physics_json
                from app.physics import build_user_message as build_message
                try:
                    # Get job info for email/direction/medium
                    job_resp = sb.table("wt_jobs").select(
                        "user_email,direction,medium,plan"
                    ).eq("id", job_id).limit(1).execute()
                    job_info = job_resp.data[0] if job_resp.data else {}
                    msg = build_message(
                        result=phys,
                        medium=job_info.get("medium","air"),
                        version=job_info.get("plan","basic"),
                        lang="en"
                    )
                except Exception as _me:
                    log.warning(f"[PHYSICS] rebuild msg failed: {_me}")
                    msg = {"moved": True}
                return {"message": msg, "result": phys,
                        "phases": {}, "physics_url": f"/physics/{job_id}"}
    except Exception as e:
        log.warning(f"[PHYSICS] DB read failed: {e}")
    raise HTTPException(404, "Physics not found — may need to reprocess")

@app.get("/csv/{job_id}")
def csv_download(job_id: str):
    p = get_csv_path(job_id)
    if not p.exists(): raise HTTPException(404,"CSV not found")
    return FileResponse(str(p),media_type="text/csv",filename=p.name)

@app.get("/jobs")
def list_jobs():
    return {"jobs":{k:{kk:vv for kk,vv in v.items() if kk!="progress"}
                    for k,v in jobs.items()}}

# Secret token for internal API endpoints
_API_TOKEN = os.environ.get("API_TOKEN", "")

def _check_token(token: str = ""):
    if _API_TOKEN and token != _API_TOKEN:
        raise HTTPException(401, "Unauthorized")

@app.get("/api/jobs")
def api_jobs(email: str = "", limit: int = 200, token: str = ""):
    """Return jobs from Supabase DB for history page."""
    _check_token(token)
    rows = get_all_jobs(email_filter=email, limit=limit)
    for row in rows:
        mem = jobs.get(row["id"], {})
        if mem.get("physics"):
            row["physics"] = mem["physics"]
        if mem.get("message"):
            row["message"] = mem["message"]
    return {"jobs": rows}

# ── WebSocket stream ───────────────────────────────────────────────────────
@app.websocket("/stream")
async def stream_ws(ws: WebSocket):
    await ws.accept()
    params  = dict(ws.query_params)
    email   = params.get("email",   "")
    job_id  = str(uuid.uuid4())

    _req_version = params.get("version", DEFAULT_VERSION)
    # Master always gets Pro features regardless of plan
    if _is_master(email):
        _req_version = "pro"
    _sp = {
        "direction": params.get("direction", DEFAULT_DIRECTION),
        "medium":    params.get("medium",    DEFAULT_MEDIUM),
        "email":     email,
        "version":   _req_version,
        "lang":      params.get("lang",       DEFAULT_LANG),
    }
    create_job(job_id, email, "stream", _sp["direction"], _sp["medium"], False, "basic")
    jobs[job_id] = {"status":"streaming", "user_email": email,
                    "source_type": "stream",
                    "created_at": datetime.datetime.utcnow().isoformat(),
                    "progress": {"pct":0}}
    log.info(f"[WS] {ws.client}  job={job_id}")
    await ws.send_text(json.dumps({"type":"init","job_id":job_id}))

    import time as _time
    frame_times  = []
    frame_buffer = []
    fps_assumed  = 5.0
    out_path     = OUTPUTS_DIR / f"{job_id}_stream.mp4"
    frame_idx    = 0

    try:
        while True:
            data  = await ws.receive_bytes()
            frame = cv2.imdecode(np.frombuffer(data, np.uint8), cv2.IMREAD_COLOR)
            if frame is None:
                await ws.send_text(json.dumps({"error":"bad frame"}))
                continue

            # Track real FPS
            frame_times.append(_time.monotonic())
            if len(frame_times) > 20: frame_times.pop(0)
            if len(frame_times) >= 2:
                elapsed = frame_times[-1] - frame_times[0]
                if elapsed > 0:
                    fps_assumed = max(1.0, (len(frame_times)-1) / elapsed)

            frame_buffer.append(frame.copy())
            await ws.send_text(json.dumps({"type":"ack","frame":frame_idx}))
            frame_idx += 1

    except WebSocketDisconnect:
        log.info(f"[WS] disconnected after {frame_idx} frames")
    except Exception as exc:
        log.error(f"[WS] error: {exc}", exc_info=True)
        try: await ws.send_text(json.dumps({"error":str(exc)}))
        except: pass
    finally:
        # Write buffered frames with real FPS
        if frame_buffer:
            if len(frame_times) >= 2:
                elapsed = frame_times[-1] - frame_times[0]
                real_fps = max(1.0, (len(frame_times)-1) / elapsed)
            else:
                real_fps = fps_assumed
            log.info(f"[WS] writing {len(frame_buffer)} frames at {real_fps:.1f} fps")
            fourcc = cv2.VideoWriter_fourcc(*"mp4v")
            _w = frame_buffer[0].shape[1]
            _h = frame_buffer[0].shape[0]
            writer = cv2.VideoWriter(str(out_path), fourcc, real_fps, (_w, _h))
            for f in frame_buffer:
                writer.write(f)
            writer.release()
            log.info(f"[WS] video saved: {out_path}")
        frame_buffer.clear()
        finish_job(job_id, frame_idx, 0)
        # Process recorded video in background — same as upload pipeline
        if out_path.exists():
            jobs[job_id] = {"status":"queued","progress":{"pct":0},
                            "user_email": _sp["email"],
                            "source_type": "stream"}
            asyncio.get_event_loop().run_in_executor(
                executor, _run_job, job_id, out_path,
                _sp["direction"], _sp["medium"],
                False, "basic",
                _sp["email"], _sp["version"], _sp["lang"],
            )
            log.info(f"[WS] queued _run_job {job_id} email={_sp['email']}")

# ── Master user endpoints ─────────────────────────────────────────────────
MASTER_TOKEN = os.environ.get("MASTER_TOKEN", "wt_master_2026")
_MASTER_EMAILS = ["azatkb22@gmail.com", "lajtnert@gmail.com"]

def _master_ok(email="", token=""):
    return (email or "").lower() in _MASTER_EMAILS or token == MASTER_TOKEN

# ── Pioneer / Founder / Alpha unit allocation ───────────────────────────────
@app.get("/allocation/{series}")
def allocation_list(series: str):
    """Public: list all units of a series with status available/allocated.
    series ∈ pioneer(50) | founder(50) | alpha(500)."""
    series = series.lower()
    totals = {"pioneer": 50, "founder": 50, "alpha": 500}
    if series not in totals:
        raise HTTPException(404, "Unknown series")
    total = totals[series]
    taken = {}
    from app.database import _sb
    sb = _sb()
    if sb:
        try:
            r = sb.table("unit_allocations").select("number, status, notes").eq("series", series).execute()
            for row in (r.data or []):
                taken[int(row["number"])] = {"status": row.get("status", "allocated"),
                                             "notes": row.get("notes") or ""}
        except Exception as e:
            log.warning(f"[ALLOC] read failed: {e}")
    prefix = {"pioneer": "PIONEER", "founder": "FOUNDER", "alpha": "ALPHA"}[series]
    pad = 3 if series == "alpha" else 2
    units = []
    for n in range(1, total + 1):
        t = taken.get(n)
        status = t["status"] if t else "available"
        notes  = t["notes"] if t else ("Ready to Claim" if status == "available" else "")
        units.append({
            "number": n,
            "serial": f"{prefix} #{str(n).zfill(pad)} of #{total}",
            "status": status,
            "notes": notes or ("Ready to Claim" if status == "available" else "Reserved"),
        })
    allocated = sum(1 for u in units if u["status"] != "available")
    return {"series": series, "total": total, "allocated": allocated, "units": units}


@app.post("/allocation/checkout")
async def allocation_checkout(request: Request):
    """Create a Stripe checkout for one numbered unit. Marks it 'pending' so it
    can't be double-sold; the webhook flips it to 'allocated' once paid."""
    body = await request.json()
    series = (body.get("series") or "pioneer").lower()
    number = int(body.get("number") or 0)
    email  = (body.get("email") or "").strip().lower()
    name   = (body.get("name") or "").strip()
    ship   = body.get("shipping") or {}
    price  = {"pioneer": 249, "founder": None, "alpha": None}.get(series)
    if not email or not name or not number:
        raise HTTPException(400, "Name, email and number are required")
    if series != "pioneer" or not price:
        raise HTTPException(400, "This series is not open for sale yet")

    from app.database import _sb
    sb = _sb()
    if sb:
        # reject if already taken
        ex = sb.table("unit_allocations").select("status").eq("series", series).eq("number", number).execute()
        if ex.data and ex.data[0].get("status") in ("allocated", "pending"):
            raise HTTPException(409, f"#{number:02d} is no longer available")
        sb.table("unit_allocations").upsert({
            "series": series, "number": number, "status": "pending",
            "buyer_email": email, "buyer_name": name,
            "shipping": json.dumps(ship), "created_at": datetime.datetime.utcnow().isoformat(),
        }, on_conflict="series,number").execute()

    if not STRIPE_SECRET_KEY:
        raise HTTPException(503, "Stripe not configured")
    import stripe
    stripe.api_key = STRIPE_SECRET_KEY
    session = stripe.checkout.Session.create(
        payment_method_types=["card"], mode="payment", customer_email=email,
        line_items=[{"price_data": {"currency": "usd",
            "product_data": {"name": f"Lajtner {series.title()} #{number:02d} of {50}"},
            "unit_amount": price * 100}, "quantity": 1}],
        shipping_address_collection={"allowed_countries": ["US","GB","DE","HU","FR","AT","CA","AU"]},
        success_url=body.get("success_url", "https://lajtnerresonance.com/thankyou"),
        cancel_url=body.get("cancel_url", "https://lajtnerresonance.com/pioneer"),
        metadata={"kind": "unit", "series": series, "number": str(number),
                  "email": email, "name": name},
    )
    return {"url": session.url, "session_id": session.id}


def _finalize_unit(series, number, email, name):
    """Mark a unit allocated + send confirmation email. Called from the webhook."""
    from app.database import _sb
    sb = _sb()
    if sb:
        try:
            sb.table("unit_allocations").upsert({
                "series": series, "number": number, "status": "allocated",
                "buyer_email": email, "buyer_name": name,
                "paid_at": datetime.datetime.utcnow().isoformat(),
            }, on_conflict="series,number").execute()
        except Exception as e:
            log.error(f"[ALLOC] finalize failed: {e}")
    _send_pioneer_email(email, name, series, number)


def _send_pioneer_email(email, name, series, number):
    GMAIL_USER = os.environ.get("GMAIL_USER", "")
    GMAIL_PASS = os.environ.get("GMAIL_PASS", "")
    if not (GMAIL_USER and GMAIL_PASS):
        log.warning("[ALLOC] GMAIL not set — confirmation email skipped")
        return
    try:
        import smtplib
        from email.mime.text import MIMEText
        from email.mime.multipart import MIMEMultipart
        label = f"{series.title()} #{number:02d} of 50"
        msg = MIMEMultipart("alternative")
        msg["Subject"] = f"Confirmation of Your Pioneer Order – Lajtner Resonance {label}"
        msg["From"] = f"Lajtner Resonance <{GMAIL_USER}>"
        msg["To"] = email
        text = (f"Dear {name},\n\n"
                f"Thank you very much for your order, and congratulations on securing your place "
                f"in the Pioneer program!\n\n"
                f"We are pleased to confirm that {label} has been successfully reserved for you. "
                f"We deeply appreciate your trust and support in joining us at the very beginning of "
                f"this journey.\n\n"
                f"As your device is being crafted to order, we will keep you updated on its progress "
                f"and send you a notification with full shipping details as soon as it is ready to be "
                f"dispatched.\n\n"
                f"Thank you once again for your partnership in shaping the future of Lajtner Resonance. "
                f"If you have any questions in the meantime, please do not hesitate to reach out directly.\n\n"
                f"Warm regards,\n\nDr. Tamás Lajtner\nLajtner Resonance")
        msg.attach(MIMEText(text, "plain"))
        with smtplib.SMTP_SSL("smtp.gmail.com", 465) as s:
            s.login(GMAIL_USER, GMAIL_PASS)
            s.sendmail(GMAIL_USER, email, msg.as_string())
        log.info(f"[ALLOC] confirmation email sent to {email} for {label}")
    except Exception as e:
        log.error(f"[ALLOC] email failed: {e}")


# ── Block / unblock users (admin) ───────────────────────────────────────────
@app.post("/admin/block-user")
async def admin_block_user(request: Request):
    body = await request.json()
    if not _master_ok(body.get("admin_email", ""), body.get("token", "")):
        raise HTTPException(401, "Unauthorized")
    target = (body.get("email") or "").strip().lower()
    blocked = bool(body.get("blocked", True))
    if not target:
        raise HTTPException(400, "email required")
    from app.database import _sb
    sb = _sb()
    if sb:
        sb.table("wt_users").update({"blocked": blocked}).eq("email", target).execute()
    log.info(f"[ADMIN] {'blocked' if blocked else 'unblocked'} {target}")
    return {"ok": True, "email": target, "blocked": blocked}


@app.get("/master/all")
def master_all(email: str = "", token: str = "", limit: int = 1000):
    """Master: read all physics results from all users."""
    MASTER_EMAILS = ["azatkb22@gmail.com", "lajtnert@gmail.com"]
    if email not in MASTER_EMAILS and token != MASTER_TOKEN:
        raise HTTPException(401, "Unauthorized")
    rows = get_master_data(limit=limit)
    return {"count": len(rows), "rows": rows}

@app.get("/master/export-csv")
def master_export_csv(email: str = "", token: str = ""):
    """Master: export all data to CSV for Excel."""
    MASTER_EMAILS = ["azatkb22@gmail.com", "lajtnert@gmail.com"]
    if email not in MASTER_EMAILS and token != MASTER_TOKEN:
        raise HTTPException(401, "Unauthorized")
    from app.config import OUTPUTS_DIR
    out = OUTPUTS_DIR / "master_export.csv"
    n = export_to_master_csv(str(out))
    if n == 0:
        raise HTTPException(404, "No data")
    return FileResponse(str(out), media_type="text/csv",
                        filename="wheel_tracker_all_data.csv")

@app.post("/admin/set-plan")
def admin_set_plan(email: str, plan: str, admin: str = ""):
    """Master: manually set user plan to free or paid."""
    MASTER_EMAILS = ["azatkb22@gmail.com"]
    if admin not in MASTER_EMAILS:
        raise HTTPException(401, "Unauthorized")
    if plan not in ("basic", "pro"):
        raise HTTPException(400, "plan must be 'basic' or 'pro'")
    try:
        from app.database import _sb
        sb = _sb()
        if sb is None:
            raise HTTPException(500, "DB unavailable")
        sb.table("wt_users").update({"plan": plan}).eq("email", email).execute()
        log.info(f"[ADMIN] set-plan: {email} → {plan}")
        return {"ok": True, "email": email, "plan": plan}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(500, str(e))


@app.get("/master/users")
def master_users(email: str = "", token: str = ""):
    """Master: list all users (from wt_users) with measurement counts + blocked flag."""
    if not _master_ok(email, token):
        raise HTTPException(401, "Unauthorized")
    rows = get_master_data(limit=10000)
    from collections import defaultdict
    counts = defaultdict(int)
    for r in rows:
        counts[(r.get("email") or "?").lower()] += 1
    # pull the full user list (so users with 0 measurements also appear) + blocked flag
    users = {}
    from app.database import _sb
    sb = _sb()
    if sb:
        try:
            ur = sb.table("wt_users").select("email, plan, blocked").execute()
            for u in (ur.data or []):
                em = (u.get("email") or "").lower()
                if em:
                    users[em] = {"email": em, "plan": u.get("plan", "basic"),
                                 "blocked": bool(u.get("blocked")), "count": counts.get(em, 0)}
        except Exception as e:
            log.warning(f"[MASTER-USERS] read failed: {e}")
    # include any measurement emails not in wt_users
    for em, c in counts.items():
        if em not in users:
            users[em] = {"email": em, "plan": "basic", "blocked": False, "count": c}
    return {"users": sorted(users.values(), key=lambda x: (-x["count"], x["email"]))}

@app.get("/bar-data/{email}")
def bar_data(email: str, token: str = ""):
    """Return bar chart data: last2 + user_avg + group_avg."""
    data = get_user_bar_data(email)
    return data

@app.post("/admin/rerun-physics/{job_id}")
async def rerun_physics(job_id: str, medium: str = "air", version: str = "basic",
                        lang: str = "en", direction: str = "auto", email: str = ""):
    """Re-run physics calculation for a job using saved samples."""
    samples = read_samples(job_id)
    if not samples:
        raise HTTPException(404, "No samples found for this job")
    physics = _run_physics(samples, medium, direction, email, job_id, version, lang)
    if job_id in jobs:
        jobs[job_id]["message"] = physics.get("message", {})
        jobs[job_id]["physics"] = physics.get("result", {})
        jobs[job_id]["phases"]  = physics.get("phases", {})
    return {"ok": True, "samples": len(samples),
            "message": physics.get("message", {}).get("message", "")}


# ─────────────────────────────────────────────
# QUESTIONNAIRE — 8 Primary Factors of Mental Focus
# ─────────────────────────────────────────────

Q_FIELDS = ["q1_illness","q2_loneliness","q3_sleep","q4_homeostasis",
            "q5_stimulants","q6_digital","q7_breathing","q8_emotional"]

@app.post("/questionnaire")
async def questionnaire_save(req: Request):
    """Save a questionnaire response. Unanswered = 0."""
    from app.database import _sb
    body = await req.json()
    sb = _sb()
    if not sb: raise HTTPException(500, "DB unavailable")
    email = (body.get("user_email") or "").strip().lower()
    if not email: raise HTTPException(400, "email required")
    data = {"user_email": email, "is_measurement": bool(body.get("is_measurement", True))}
    answered = 0
    for f in Q_FIELDS:
        v = int(body.get(f, 0) or 0)
        data[f] = v
        if v > 0: answered += 1
    data["answered_count"] = answered
    if body.get("job_id"): data["job_id"] = body["job_id"]
    try:
        resp = sb.table("focus_questionnaire").insert(data).execute()
        return {"ok": True, "id": resp.data[0]["id"] if resp.data else None}
    except Exception as e:
        log.error(f"[QUESTIONNAIRE] save error: {e}")
        raise HTTPException(500, str(e))


@app.get("/questionnaire/my")
def questionnaire_my(email: str = ""):
    """Get a user's own questionnaire responses."""
    from app.database import _sb
    if not email: raise HTTPException(400, "email required")
    sb = _sb()
    resp = sb.table("focus_questionnaire").select("*")        .eq("user_email", email).order("created_at", desc=True).execute()
    return {"responses": resp.data or []}


@app.get("/questionnaire/all")
def questionnaire_all(admin_email: str = "", limit: int = 1000):
    """All questionnaire responses (master only)."""
    from app.database import _sb
    if not _is_master(admin_email): raise HTTPException(403, "Master only")
    sb = _sb()
    resp = sb.table("focus_questionnaire").select("*")        .order("created_at", desc=True).limit(limit).execute()
    return {"responses": resp.data or [], "count": len(resp.data or [])}


@app.get("/questionnaire/export-csv")
def questionnaire_export_csv(admin_email: str = ""):
    """Export all questionnaire data as CSV (master only)."""
    from app.database import _sb
    from fastapi.responses import PlainTextResponse
    if not _is_master(admin_email): raise HTTPException(403, "Master only")
    sb = _sb()
    resp = sb.table("focus_questionnaire").select("*")        .order("created_at").execute()
    rows = resp.data or []
    header = ["id","user_email","created_at","is_measurement","answered_count"] + Q_FIELDS + ["job_id"]
    lines = [",".join(header)]
    for r in rows:
        line = [
            str(r.get("id","")), r.get("user_email",""), r.get("created_at",""),
            "measurement" if r.get("is_measurement") else "non-measurement",
            str(r.get("answered_count",0)),
        ] + [str(r.get(f,0)) for f in Q_FIELDS] + [str(r.get("job_id",""))]
        lines.append(",".join(line))
    csv_text = "\n".join(lines)
    return PlainTextResponse(csv_text, headers={
        "Content-Disposition": "attachment; filename=focus_questionnaire.csv"
    })


# ─────────────────────────────────────────────
# STATISTICS — Odds Ratio (pure math, no scipy)
# ─────────────────────────────────────────────

def _odds_ratio(A, B, C, D):
    """Odds Ratio + 95% CI + Chi-square p-value using scipy.stats (as specified)."""
    import numpy as np
    import scipy.stats as stats
    data = np.array([[int(A), int(B)], [int(C), int(D)]], dtype=int)
    # Odds Ratio + 95% CI
    res_or = stats.contingency.odds_ratio(data)
    odds_ratio = float(res_or.statistic)
    ci_lower, ci_upper = res_or.confidence_interval(confidence_level=0.95)
    # Chi-square (pure formula, Yates correction off)
    chi2_stat, p_value, dof, expected = stats.chi2_contingency(data, correction=False)
    N = A + B + C + D
    return {
        "N": int(N), "A": int(A), "B": int(B), "C": int(C), "D": int(D),
        "odds_ratio": round(odds_ratio, 4),
        "ci_lower": round(float(ci_lower), 4),
        "ci_upper": round(float(ci_upper), 4),
        "chi2": round(float(chi2_stat), 4),
        "p_value": round(float(p_value), 5),
        "significant": bool(p_value < 0.05),
    }


@app.post("/stats/odds-ratio")
async def stats_odds_ratio(req: Request):
    """
    Compute Odds Ratio from a 2x2 table.
    Body: {A, B, C, D}  (raw counts)
       or: {group1_label, group2_label} for nice formatting
    """
    body = await req.json()
    try:
        A = float(body.get("A", 0))
        B = float(body.get("B", 0))
        C = float(body.get("C", 0))
        D = float(body.get("D", 0))
    except (TypeError, ValueError):
        raise HTTPException(400, "A, B, C, D must be numbers")
    if A < 0 or B < 0 or C < 0 or D < 0:
        raise HTTPException(400, "Counts must be non-negative")
    result = _odds_ratio(A, B, C, D)
    # Build a plain-English summary line (the "troll-proof" footnote)
    g1 = body.get("group1_label", "Group 1")
    g2 = body.get("group2_label", "Group 2")
    OR = result["odds_ratio"]
    if OR >= 1:
        result["summary"] = f"{g1} have {OR:.2f}x higher odds of high result than {g2}"
    else:
        result["summary"] = f"{g1} have {OR:.2f}x the odds ({1/OR:.2f}x lower) vs {g2}"
    result["footnote"] = f"(OR = {OR}; 95% CI: {result['ci_lower']}-{result['ci_upper']}; p {'<' if result['p_value']<0.05 else '='} {max(result['p_value'],0.001):.3f})"
    return result


@app.get("/stats/factor-analysis")
def stats_factor_analysis(factor: str = "q1_illness", admin_email: str = ""):
    """
    Odds Ratio for one focus factor vs power (high/low by average power).
    factor: one of q1_illness ... q8_emotional
    Joins focus_questionnaire with physics_results by email.
    """
    from app.database import _sb, get_group_averages
    import numpy as np, scipy.stats as stats
    if not _is_master(admin_email):
        raise HTTPException(403, "Master only")
    if factor not in Q_FIELDS:
        raise HTTPException(400, f"factor must be one of {Q_FIELDS}")
    sb = _sb()
    if not sb: raise HTTPException(500, "DB unavailable")

    # Average power of all users
    grp = get_group_averages()
    avg_power = grp.get("P_peak_air", 0) or 0

    # Per-user latest power
    pr = sb.table("physics_results").select("email,p_peak_air").execute()
    power_by_email = {}
    for r in (pr.data or []):
        e = r.get("email"); p = r.get("p_peak_air")
        if e and p is not None:
            power_by_email[e] = float(p)   # latest wins

    if avg_power <= 0 and power_by_email:
        avg_power = sum(power_by_email.values()) / len(power_by_email)

    # Questionnaire answers
    q = sb.table("focus_questionnaire").select(f"user_email,{factor}").execute()

    # Build 2x2: rows = answer (1=opt1 / 2=opt2), cols = high/low power
    A=B=C=D=0
    for r in (q.data or []):
        email = r.get("user_email")
        ans = r.get(factor, 0)
        if not ans or email not in power_by_email:
            continue
        is_high = power_by_email[email] >= avg_power
        is_opt1 = (ans == 1)
        if is_opt1 and is_high:   A+=1
        elif is_opt1:             B+=1
        elif is_high:             C+=1
        else:                     D+=1

    total = A+B+C+D
    if total < 4:
        return {"factor": factor, "n": total,
                "error": "Not enough paired data (need 4+ users with both power and answer)"}

    result = _odds_ratio(A, B, C, D)
    result["factor"] = factor
    result["avg_power"] = round(avg_power, 6)
    return result


@app.get("/stats/odds-ratio-auto")
def stats_odds_ratio_auto(admin_email: str = "", threshold: float = 0, metric: str = "lr"):
    """
    Auto-build 2x2 from physics_results split by median LR.
    Splits all measurements into High/Low by threshold (or median),
    grouped by paid vs free users as the binary trait (demo).
    """
    from app.database import _sb
    import math as _m, statistics as _stats
    if not _is_master(admin_email):
        raise HTTPException(403, "Master only")
    sb = _sb()
    resp = sb.table("physics_results").select("email,w_total_air,omega_max").execute()
    rows = resp.data or []
    if len(rows) < 4:
        raise HTTPException(400, "Need at least 4 measurements")

    # Compute metric value per row
    def metric_val(r):
        if metric == "lr":
            e = r.get("w_total_air") or 0
            return e / 6.626e-34 if e > 0 else 0
        else:
            return (r.get("omega_max") or 0) * 180 / _m.pi

    vals = [metric_val(r) for r in rows]
    med = threshold if threshold > 0 else _stats.median([v for v in vals if v > 0])

    # Binary trait: paid vs free (placeholder until real traits collected)
    paid_emails = set()
    users_resp = sb.table("wt_users").select("email,plan").execute()
    for u in (users_resp.data or []):
        if u.get("plan") in ("pro", "ultimate"):
            paid_emails.add(u["email"])

    A = B = C = D = 0
    for r, v in zip(rows, vals):
        is_paid = r.get("email") in paid_emails
        is_high = v >= med
        if is_paid and is_high:   A += 1
        elif is_paid:             B += 1
        elif is_high:             C += 1
        else:                     D += 1

    result = _odds_ratio(A, B, C, D)
    result["threshold_used"] = round(med, 2)
    result["metric"] = metric
    return result


# ─────────────────────────────────────────────
# reCAPTCHA verification
# ─────────────────────────────────────────────

async def _verify_recaptcha(token: str) -> bool:
    """Verify Google reCAPTCHA v2 token."""
    import os as _os, httpx as _hx
    secret = _os.environ.get("RECAPTCHA_SECRET_KEY", "")
    if not secret:
        log.warning("[RECAPTCHA] No secret key set — skipping verification")
        return True  # Skip if not configured
    # Test key always passes
    if secret == "6LeIxAcTAAAAAGG-vFI1TnRWxMZNFuojJ4WifJWe":
        return True
    try:
        r = await _hx.AsyncClient().post(
            "https://www.google.com/recaptcha/api/siteverify",
            data={"secret": secret, "response": token},
            timeout=5
        )
        result = r.json()
        return result.get("success", False)
    except Exception as e:
        log.warning(f"[RECAPTCHA] verify failed: {e}")
        return False


# ─────────────────────────────────────────────
# FORUM endpoints
# ─────────────────────────────────────────────

@app.get("/forum/leaderboard")
def forum_leaderboard(type: str = "lr", limit: int = 20):
    """Anonymous leaderboard by Lajtner Resonance or velocity."""
    from app.database import _sb
    import json as _json, math as _math
    sb = _sb()
    if not sb: raise HTTPException(500, "DB unavailable")
    try:
        resp = sb.table("physics_results")            .select("w_total_air,omega_max,cumulative_deg,created_at")            .execute()
        rows = resp.data or []
        entries = []
        for i, row in enumerate(rows):
            if type == "lr":
                energy = row.get("w_total_air") or 0
                if energy <= 0: continue
                freq = energy / 6.626e-34
                exp = int(_math.floor(_math.log10(abs(freq))))
                mant = freq / (10 ** exp)
                val = f"{mant:.2f}L{exp:+d}R"
                sort_key = freq
            else:  # velocity
                omega = row.get("omega_max") or 0
                if omega <= 0: continue
                deg_s = omega * 180 / _math.pi
                val = f"{deg_s:.3f} °/s"
                sort_key = deg_s
            entries.append({"sort_key": sort_key, "value": val})
        entries.sort(key=lambda x: x["sort_key"], reverse=True)
        # Return top N with anonymous rank_id
        result = [{"rank_id": i+1, "value": e["value"]}
                  for i, e in enumerate(entries[:limit])]
        return {"entries": result}
    except Exception as e:
        log.error(f"[FORUM] leaderboard error: {e}")
        raise HTTPException(500, str(e))


@app.get("/forum/posts")
def forum_get_posts(limit: int = 10, offset: int = 0, category: str = ""):
    """Get forum posts with pagination and category filter."""
    from app.database import _sb
    sb = _sb()
    if not sb: raise HTTPException(500, "DB unavailable")
    try:
        q_count = sb.table("forum_posts").select("id", count="exact")
        q_page  = sb.table("forum_posts").select("*")
        if category and category != "all":
            q_count = q_count.eq("category", category)
            q_page  = q_page.eq("category", category)
        total = (q_count.execute().count or 0)
        resp  = q_page            .order("pinned", desc=True)            .order("created_at", desc=True)            .range(offset, offset + limit - 1)            .execute()
        return {"posts": resp.data or [], "total": total, "count": len(resp.data or [])}
    except Exception as e:
        log.error(f"[FORUM] get_posts error: {e}")
        raise HTTPException(500, f"DB error: {e}")


@app.post("/forum/posts")
async def forum_create_post(req: Request):
    """Create a new forum post."""
    body = await req.json()
    from app.database import _sb
    sb = _sb()
    if not sb: raise HTTPException(500, "DB unavailable")
    user_email = body.get("user_email","").strip()
    title = body.get("title","").strip()
    text  = body.get("body","").strip()
    if not user_email or not title or not text:
        raise HTTPException(400, "user_email, title and body are required")
    data = {
        "user_email":   user_email,
        "title":        title[:200],
        "body":         text[:2000],
        "job_id":       body.get("job_id"),
        "lr_value":     body.get("lr_value"),
        "rotation_deg": body.get("rotation_deg"),
        "medium":       body.get("medium","air"),
        "category":     body.get("category","general"),
    }
    resp = sb.table("forum_posts").insert(data).execute()
    return {"ok": True, "post": resp.data[0] if resp.data else {}}


@app.delete("/forum/posts/{post_id}")
def forum_delete_post(post_id: str, email: str = ""):
    """Delete a post (own post or master)."""
    MASTER_EMAILS = ["azatkb22@gmail.com", "lajtnert@gmail.com"]
    from app.database import _sb
    sb = _sb()
    if not sb: raise HTTPException(500, "DB unavailable")
    resp = sb.table("forum_posts").select("user_email").eq("id", post_id).execute()
    if not resp.data: raise HTTPException(404, "Post not found")
    if email != resp.data[0]["user_email"] and email not in MASTER_EMAILS:
        raise HTTPException(403, "Forbidden")
    sb.table("forum_posts").delete().eq("id", post_id).execute()
    return {"ok": True}


@app.get("/forum/posts/{post_id}/comments")
def forum_get_comments(post_id: str):
    """Get comments for a post."""
    from app.database import _sb
    sb = _sb()
    if not sb: raise HTTPException(500, "DB unavailable")
    resp = sb.table("forum_comments")        .select("*")        .eq("post_id", post_id)        .order("created_at")        .execute()
    return {"comments": resp.data or []}


@app.post("/forum/posts/{post_id}/comments")
async def forum_add_comment(post_id: str, req: Request):
    """Add a comment to a post."""
    body = await req.json()
    from app.database import _sb
    sb = _sb()
    if not sb: raise HTTPException(500, "DB unavailable")
    user_email = body.get("user_email","").strip()
    text = body.get("body","").strip()
    if not user_email or not text:
        raise HTTPException(400, "user_email and body required")
    data = {
        "post_id":    post_id,
        "user_email": user_email,
        "body":       text[:1000],
    }
    resp = sb.table("forum_comments").insert(data).execute()
    # Notify post author
    try:
        post_resp = sb.table("forum_posts").select("user_email").eq("id", post_id).execute()
        if post_resp.data:
            post_author = post_resp.data[0]["user_email"]
            if post_author != user_email:
                notif_data = {
                    "user_email": post_author,
                    "from_email": user_email,
                    "post_id": post_id,
                    "comment_id": resp.data[0]["id"] if resp.data else None,
                    "type": "comment",
                }
                sb.table("forum_notifications").insert(notif_data).execute()
    except Exception as _ne:
        log.warning(f"[FORUM] notification failed: {_ne}")
    return {"ok": True, "comment": resp.data[0] if resp.data else {}}


@app.post("/forum/like")
async def forum_like(req: Request):
    """Toggle like on post or comment."""
    body = await req.json()
    from app.database import _sb
    sb = _sb()
    if not sb: raise HTTPException(500, "DB unavailable")
    user_email  = body.get("user_email","")
    target_id   = body.get("target_id","")
    target_type = body.get("target_type","post")  # 'post' or 'comment'
    tbl = "forum_posts" if target_type == "post" else "forum_comments"
    # Check if already liked
    existing = sb.table("forum_likes")        .select("id")        .eq("user_email", user_email)        .eq("target_id", target_id)        .execute()
    if existing.data:
        # Unlike
        sb.table("forum_likes").delete().eq("id", existing.data[0]["id"]).execute()
        cur_resp = sb.table(tbl).select("likes").eq("id", target_id).execute()
        cur = (cur_resp.data[0]["likes"] or 0) if cur_resp.data else 0
        sb.table(tbl).update({"likes": max(0, cur - 1)}).eq("id", target_id).execute()
        return {"liked": False}
    else:
        # Like
        sb.table("forum_likes").insert({
            "user_email": user_email,
            "target_id": target_id,
            "target_type": target_type
        }).execute()
        cur_resp = sb.table(tbl).select("likes").eq("id", target_id).execute()
        cur = (cur_resp.data[0]["likes"] or 0) if cur_resp.data else 0
        sb.table(tbl).update({"likes": cur + 1}).eq("id", target_id).execute()
        # Notify post/comment author
        try:
            author_resp = sb.table(tbl).select("user_email").eq("id", target_id).execute()
            if author_resp.data:
                author = author_resp.data[0]["user_email"]
                if author != user_email:
                    sb.table("forum_notifications").insert({
                        "user_email": author,
                        "from_email": user_email,
                        "post_id": target_id if target_type == "post" else None,
                        "type": "like",
                    }).execute()
        except Exception as _ne:
            log.warning(f"[FORUM] like notification failed: {_ne}")
        return {"liked": True}


# ── Forum notifications ─────────────────────────────────────────────────

@app.get("/forum/notifications")
def forum_get_notifications(email: str = ""):
    """Get unread notifications for a user."""
    from app.database import _sb
    sb = _sb()
    if not sb or not email: raise HTTPException(400, "email required")
    resp = sb.table("forum_notifications")        .select("*")        .eq("user_email", email)        .order("created_at", desc=True)        .limit(30)        .execute()
    return {"notifications": resp.data or []}


@app.post("/forum/notifications/seen")
async def forum_mark_seen(req: Request):
    """Mark all notifications as seen."""
    from app.database import _sb
    body = await req.json()
    sb = _sb()
    if not sb: raise HTTPException(500, "DB unavailable")
    email = body.get("email","")
    sb.table("forum_notifications")        .update({"seen": True})        .eq("user_email", email)        .eq("seen", False)        .execute()
    return {"ok": True}


@app.delete("/forum/comments/{comment_id}")
def forum_delete_comment(comment_id: str, email: str = ""):
    """Delete a comment (own or master)."""
    MASTER_EMAILS = ["azatkb22@gmail.com", "lajtnert@gmail.com"]
    from app.database import _sb
    sb = _sb()
    if not sb: raise HTTPException(500, "DB unavailable")
    resp = sb.table("forum_comments").select("user_email").eq("id", comment_id).execute()
    if not resp.data: raise HTTPException(404, "Comment not found")
    if email != resp.data[0]["user_email"] and email not in MASTER_EMAILS:
        raise HTTPException(403, "Forbidden")
    sb.table("forum_comments").delete().eq("id", comment_id).execute()
    return {"ok": True}


@app.post("/forum/pin/{post_id}")
def forum_pin_post(post_id: str, email: str = ""):
    """Pin/unpin a post (master only)."""
    MASTER_EMAILS = ["azatkb22@gmail.com", "lajtnert@gmail.com"]
    if email not in MASTER_EMAILS:
        raise HTTPException(403, "Master only")
    from app.database import _sb
    sb = _sb()
    if not sb: raise HTTPException(500, "DB unavailable")
    resp = sb.table("forum_posts").select("pinned").eq("id", post_id).execute()
    if not resp.data: raise HTTPException(404, "Not found")
    new_val = not resp.data[0]["pinned"]
    sb.table("forum_posts").update({"pinned": new_val}).eq("id", post_id).execute()
    return {"ok": True, "pinned": new_val}



# ═══════════════════════════════════════════════════════════════
# STORE endpoints
# ═══════════════════════════════════════════════════════════════

MASTER_STORE = ["azatkb22@gmail.com", "lajtnert@gmail.com"]
DHL_ORIGIN = {"country": "HU", "city": "Budapest", "postalCode": "1000"}

def _is_master(email: str) -> bool:
    return (email or "").lower() in [m.lower() for m in MASTER_STORE]


# ── Products ─────────────────────────────────────────────────────

@app.post("/store/upload-image")
async def store_upload_image(
    file: UploadFile = File(...),
    admin_email: str = Form(default="")
):
    """Upload product image to server."""
    if not _is_master(admin_email):
        raise HTTPException(403, "Master only")
    import shutil as _sh
    from app.config import OUTPUTS_DIR
    # Save to store/images/
    img_dir = OUTPUTS_DIR / "store" / "images"
    img_dir.mkdir(parents=True, exist_ok=True)
    suffix = Path(file.filename).suffix.lower()
    if suffix not in ('.jpg','.jpeg','.png','.webp','.gif'):
        raise HTTPException(400, "Image must be jpg/png/webp/gif")
    fname = f"{uuid.uuid4()}{suffix}"
    fpath = img_dir / fname
    with open(fpath, "wb") as f:
        _sh.copyfileobj(file.file, f)
    # Return public URL
    url = f"/store/images/{fname}"
    log.info(f"[STORE] Image uploaded: {fname}")
    return {"ok": True, "url": url, "filename": fname}


@app.get("/store/images/{filename}")
def store_get_image(filename: str):
    """Serve product image."""
    from fastapi.responses import FileResponse
    from app.config import OUTPUTS_DIR
    fpath = OUTPUTS_DIR / "store" / "images" / filename
    if not fpath.exists():
        raise HTTPException(404, "Image not found")
    return FileResponse(str(fpath))


@app.post("/store/upload-file")
async def store_upload_file(
    file: UploadFile = File(...),
    admin_email: str = Form(default=""),
    file_type: str = Form(default="video")  # video | pdf
):
    """Upload digital product file (video or pdf)."""
    if not _is_master(admin_email):
        raise HTTPException(403, "Master only")
    import shutil as _sh
    from app.config import OUTPUTS_DIR
    folder = "videos" if file_type == "video" else "pdfs"
    file_dir = OUTPUTS_DIR / "store" / folder
    file_dir.mkdir(parents=True, exist_ok=True)
    suffix = Path(file.filename).suffix.lower()
    fname = f"{uuid.uuid4()}{suffix}"
    fpath = file_dir / fname
    with open(fpath, "wb") as f:
        _sh.copyfileobj(file.file, f)
    url = f"/store/files/{folder}/{fname}"
    log.info(f"[STORE] File uploaded: {fname}")
    return {"ok": True, "url": url, "filename": fname}


@app.get("/store/files/{folder}/{filename}")
def store_get_file(folder: str, filename: str, email: str = "", order_id: str = ""):
    """Serve digital product file (only for paid orders)."""
    from fastapi.responses import FileResponse
    from app.database import _sb
    import json as _json
    from app.config import OUTPUTS_DIR
    # Verify purchase
    if not _is_master(email):
        sb = _sb()
        if sb and order_id:
            resp = sb.table("store_orders").select("user_email,status,items")                .eq("id", order_id).execute()
            if not resp.data or resp.data[0]["user_email"] != email:
                raise HTTPException(403, "Forbidden")
            if resp.data[0]["status"] not in ("paid","fulfilled"):
                raise HTTPException(403, "Order not paid")
        elif not order_id:
            raise HTTPException(403, "order_id required")
    fpath = OUTPUTS_DIR / "store" / folder / filename
    if not fpath.exists():
        raise HTTPException(404, "File not found")
    return FileResponse(str(fpath))


@app.get("/store/products")
def store_get_products(include_inactive: bool = False, admin_email: str = ""):
    from app.database import _sb
    sb = _sb()
    if not sb: raise HTTPException(500, "DB unavailable")
    q = sb.table("store_products").select("*")
    if not include_inactive or not _is_master(admin_email):
        q = q.eq("active", True)
    resp = q.order("created_at").execute()
    return {"products": resp.data or []}


@app.post("/store/products")
async def store_add_product(req: Request):
    from app.database import _sb
    body = await req.json()
    if not _is_master(body.get("admin_email","")):
        raise HTTPException(403, "Master only")
    sb = _sb()
    if not sb: raise HTTPException(500, "DB unavailable")
    data = {
        "name":         body["name"],
        "description":  body.get("description",""),
        "type":         body["type"],
        "price_usd":    float(body["price_usd"]),
        "price_annual": body.get("price_annual"),
        "file_url":     body.get("file_url"),
        "image_url":    body.get("image_url"),
        "stock":        body.get("stock"),
        "active":       body.get("active", True),
        "metadata":     body.get("metadata", {}),
    }
    resp = sb.table("store_products").insert(data).execute()
    return {"ok": True, "product": resp.data[0] if resp.data else {}}


@app.put("/store/products/{pid}")
async def store_update_product(pid: str, req: Request):
    from app.database import _sb
    body = await req.json()
    if not _is_master(body.get("admin_email","")):
        raise HTTPException(403, "Master only")
    sb = _sb()
    allowed = ["name","description","price_usd","price_annual","file_url",
               "image_url","stock","active","metadata","type"]
    data = {k: body[k] for k in allowed if k in body}
    sb.table("store_products").update(data).eq("id", pid).execute()
    return {"ok": True}


@app.delete("/store/products/{pid}")
def store_delete_product(pid: str, admin_email: str = ""):
    from app.database import _sb
    if not _is_master(admin_email): raise HTTPException(403, "Master only")
    sb = _sb()
    sb.table("store_products").update({"active": False}).eq("id", pid).execute()
    return {"ok": True}


# ── Coupons ──────────────────────────────────────────────────────

@app.post("/store/coupons")
async def store_create_coupon(req: Request):
    from app.database import _sb
    body = await req.json()
    if not _is_master(body.get("admin_email","")):
        raise HTTPException(403, "Master only")
    sb = _sb()
    data = {
        "code":        body["code"].upper().strip(),
        "type":        body["type"],        # percent|fixed|free
        "value":       float(body.get("value", 0)),
        "global":      body.get("global", False),
        "user_email":  body.get("user_email"),
        "max_uses":    body.get("max_uses"),
        "valid_until": body.get("valid_until"),
        "active":      True,
        "product_ids": body.get("product_ids"),
    }
    try:
        resp = sb.table("store_coupons").insert(data).execute()
        return {"ok": True, "coupon": resp.data[0] if resp.data else {}}
    except Exception as e:
        raise HTTPException(400, f"Coupon error: {e}")


@app.get("/store/coupons")
def store_list_coupons(admin_email: str = ""):
    from app.database import _sb
    if not _is_master(admin_email): raise HTTPException(403, "Master only")
    sb = _sb()
    resp = sb.table("store_coupons").select("*").order("created_at", desc=True).execute()
    return {"coupons": resp.data or []}


@app.post("/store/validate-coupon")
async def store_validate_coupon(req: Request):
    from app.database import _sb
    import datetime as _dt
    body = await req.json()
    code = body.get("code","").upper().strip()
    user_email = body.get("user_email","")
    sb = _sb()
    resp = sb.table("store_coupons").select("*").eq("code", code).eq("active", True).execute()
    if not resp.data: raise HTTPException(404, "Coupon not found")
    c = resp.data[0]
    # Check user restriction
    if not c["global"] and c.get("user_email") and c["user_email"] != user_email:
        raise HTTPException(403, "This coupon is not valid for your account")
    # Check expiry
    if c.get("valid_until"):
        exp = _dt.datetime.fromisoformat(c["valid_until"].replace("Z","+00:00"))
        if exp < _dt.datetime.now(_dt.timezone.utc):
            raise HTTPException(400, "Coupon has expired")
    # Check max uses
    if c.get("max_uses") and (c.get("used_count",0) or 0) >= c["max_uses"]:
        raise HTTPException(400, "Coupon usage limit reached")
    return {"ok": True, "coupon": c}


# ── Shipping (DHL estimate) ──────────────────────────────────────

@app.get("/store/shipping-estimate")
def store_shipping_estimate(country: str = "", postal_code: str = "", weight_kg: float = 0.3):
    """Estimate DHL shipping cost."""
    import os
    dhl_key = os.environ.get("DHL_API_KEY","")
    if not dhl_key:
        # Fallback flat rates if no DHL key
        rates = {
            "HU": 5.0, "DE": 8.0, "AT": 8.0, "SK": 8.0,
            "US": 25.0, "GB": 20.0, "FR": 15.0, "IT": 15.0,
        }
        cost = rates.get(country.upper(), 30.0)
        if weight_kg > 1.0: cost += (weight_kg - 1.0) * 8
        return {"cost_usd": round(cost, 2), "source": "flat_rate",
                "note": "Exact price calculated at order confirmation"}
    # DHL API integration
    try:
        import httpx as _hx
        headers = {"DHL-API-Key": dhl_key, "Content-Type": "application/json"}
        payload = {
            "plannedShippingDateAndTime": "2026-01-01T12:00:00GMT+01:00",
            "unitOfMeasurement": "metric",
            "isCustomsDeclarable": True,
            "monetaryAmount": [{"typeCode":"declaredValue","value":50,"currency":"USD"}],
            "requestedPackages": [{"weight": weight_kg, "dimensions":{"length":15,"width":15,"height":5}}],
            "accounts": [{"typeCode":"shipper","number": os.environ.get("DHL_ACCOUNT_NUMBER","")}],
            "customerDetails": {
                "shipperDetails": {"postalCode": DHL_ORIGIN["postalCode"],
                                   "cityName": DHL_ORIGIN["city"],
                                   "countryCode": DHL_ORIGIN["country"]},
                "receiverDetails": {"postalCode": postal_code,
                                    "cityName": "", "countryCode": country.upper()}
            }
        }
        r = _hx.post("https://api.dhl.com/rates", json=payload, headers=headers, timeout=8)
        if r.status_code == 200:
            products = r.json().get("products",[])
            if products:
                price = products[0].get("totalPrice",[{}])[0].get("price", 0)
                return {"cost_usd": round(float(price), 2), "source": "dhl"}
    except Exception as _e:
        log.warning(f"[DHL] estimate failed: {_e}")
    return {"cost_usd": 30.0, "source": "fallback"}


# ── Checkout ─────────────────────────────────────────────────────

@app.post("/store/checkout")
async def store_checkout(req: Request):
    """Create Stripe checkout session for store items."""
    from app.database import _sb
    import stripe as _stripe, json as _json, os as _os
    body = await req.json()
    user_email    = body.get("user_email","")
    items         = body.get("items", [])          # [{product_id, qty, billing:'monthly'|'annual'}]
    coupon_code   = body.get("coupon_code","")
    shipping_info = body.get("shipping", {})        # {name, addr, city, country, zip}
    shipping_cost = float(body.get("shipping_cost", 0))

    if not items: raise HTTPException(400, "No items")
    sb = _sb()
    if not sb: raise HTTPException(500, "DB unavailable")

    # Load products
    product_ids = [i["product_id"] for i in items]
    prods_resp = sb.table("store_products").select("*").in_("id", product_ids).execute()
    prods = {p["id"]: p for p in (prods_resp.data or [])}

    # Calculate total
    subtotal = 0.0
    line_items_data = []
    order_items = []
    for item in items:
        p = prods.get(item["product_id"])
        if not p: continue
        billing = item.get("billing","monthly")
        price = p["price_annual"] if billing == "annual" and p.get("price_annual") else p["price_usd"]
        qty = int(item.get("qty", 1))
        subtotal += price * qty
        order_items.append({"product_id": p["id"], "name": p["name"],
                            "qty": qty, "price": price, "type": p["type"],
                            "billing": billing, "file_url": p.get("file_url")})

    # Apply coupon
    discount = 0.0
    if coupon_code:
        try:
            c_resp = sb.table("store_coupons").select("*")                .eq("code", coupon_code.upper()).eq("active", True).execute()
            if c_resp.data:
                c = c_resp.data[0]
                if c["type"] == "percent":
                    discount = round(subtotal * c["value"] / 100, 2)
                elif c["type"] == "fixed":
                    discount = min(c["value"], subtotal)
                elif c["type"] == "free":
                    discount = subtotal
                # Increment usage
                sb.table("store_coupons").update({"used_count": (c.get("used_count") or 0) + 1})                    .eq("id", c["id"]).execute()
        except Exception as _ce:
            log.warning(f"[STORE] coupon apply failed: {_ce}")

    total = max(0.0, subtotal - discount + shipping_cost)

    # Create order record
    order_resp = sb.table("store_orders").insert({
        "user_email":   user_email,
        "status":       "pending",
        "total_usd":    round(total, 2),
        "discount_usd": round(discount, 2),
        "coupon_code":  coupon_code or None,
        "items":        _json.dumps(order_items),
        "shipping_name":    shipping_info.get("name"),
        "shipping_addr":    shipping_info.get("addr"),
        "shipping_city":    shipping_info.get("city"),
        "shipping_country": shipping_info.get("country"),
        "shipping_zip":     shipping_info.get("zip"),
        "shipping_cost":    shipping_cost,
    }).execute()
    order_id = order_resp.data[0]["id"] if order_resp.data else "unknown"

    # If total is 0 (100% coupon), fulfill immediately
    if total <= 0:
        _fulfill_order(sb, order_id, order_items, user_email)
        return {"ok": True, "free": True, "order_id": order_id}

    # Create Stripe session
    _stripe.api_key = _os.environ.get("STRIPE_SECRET_KEY","")
    FRONTEND_URL = "https://mindpw.com/kinetic"
    session = _stripe.checkout.Session.create(
        payment_method_types=["card"],
        customer_email=user_email,
        line_items=[{
            "price_data": {
                "currency": "usd",
                "product_data": {"name": f"LAJTNER Store Order #{order_id[:8]}"},
                "unit_amount": int(total * 100),
            },
            "quantity": 1,
        }],
        mode="payment",
        success_url=f"{FRONTEND_URL}/store?success=1&order={order_id}",
        cancel_url=f"{FRONTEND_URL}/store?cancel=1",
        metadata={"order_id": order_id, "user_email": user_email},
    )
    # Save stripe session
    sb.table("store_orders").update({"stripe_session": session.id})        .eq("id", order_id).execute()
    return {"ok": True, "checkout_url": session.url, "order_id": order_id}


def _fulfill_order(sb, order_id: str, items: list, user_email: str):
    """Fulfill order: activate subscriptions, grant digital files."""
    import datetime as _dt, json as _json
    try:
        for item in items:
            itype = item.get("type","")
            billing = item.get("billing","monthly")
            # Subscription activation
            if itype in ("subscription_pro", "subscription_ultimate"):
                plan = "pro" if itype == "subscription_pro" else "ultimate"
                months = 12 if billing == "annual" else 1
                expires = _dt.datetime.utcnow() + _dt.timedelta(days=30*months)
                sb.table("wt_users").update({
                    "plan": plan,
                }).eq("email", user_email).execute()
                sb.table("store_orders").update({
                    "subscription_granted": True,
                    "subscription_expires": expires.isoformat(),
                }).eq("id", order_id).execute()
            # Bundle grants
            product_id = item.get("product_id")
            if product_id:
                bundle_resp = sb.table("store_bundle_grants")                    .select("*").eq("product_id", product_id).execute()
                if bundle_resp.data:
                    grants = bundle_resp.data[0].get("grants", [])
                    if isinstance(grants, str):
                        grants = _json.loads(grants)
                    for g in grants:
                        if g.get("type") == "subscription_pro":
                            months = g.get("months", 1)
                            expires = _dt.datetime.utcnow() + _dt.timedelta(days=30*months)
                            sb.table("wt_users").update({"plan": "pro"}).eq("email", user_email).execute()
        # Mark fulfilled
        sb.table("store_orders").update({"status": "fulfilled"})            .eq("id", order_id).execute()
        log.info(f"[STORE] Order {order_id} fulfilled for {user_email}")
    except Exception as e:
        log.error(f"[STORE] fulfill error: {e}")


# ── Stripe webhook for store ─────────────────────────────────────

@app.post("/stripe/store-webhook")
async def stripe_store_webhook(req: Request):
    import stripe as _stripe, os as _os, json as _json
    from app.database import _sb
    payload = await req.body()
    sig = req.headers.get("stripe-signature","")
    webhook_secret = _os.environ.get("STRIPE_STORE_WEBHOOK_SECRET",
                     _os.environ.get("STRIPE_WEBHOOK_SECRET",""))
    try:
        event = _stripe.Webhook.construct_event(payload, sig, webhook_secret)
    except Exception as e:
        raise HTTPException(400, str(e))

    if event["type"] == "checkout.session.completed":
        session = event["data"]["object"]
        order_id   = session.get("metadata",{}).get("order_id","")
        user_email = session.get("metadata",{}).get("user_email","") or session.get("customer_email","")
        sb = _sb()
        if sb and order_id:
            order_resp = sb.table("store_orders").select("items")                .eq("id", order_id).execute()
            if order_resp.data:
                items = _json.loads(order_resp.data[0].get("items","[]"))
                sb.table("store_orders").update({
                    "status": "paid",
                    "stripe_payment": session.get("payment_intent","")
                }).eq("id", order_id).execute()
                _fulfill_order(sb, order_id, items, user_email)
    return {"ok": True}


# ── Orders ───────────────────────────────────────────────────────

@app.get("/store/orders")
def store_list_orders(admin_email: str = "", limit: int = 100):
    from app.database import _sb
    if not _is_master(admin_email): raise HTTPException(403, "Master only")
    sb = _sb()
    resp = sb.table("store_orders").select("*")        .order("created_at", desc=True).limit(limit).execute()
    return {"orders": resp.data or []}


@app.get("/store/orders/my")
def store_my_orders(email: str = ""):
    from app.database import _sb
    if not email: raise HTTPException(400, "email required")
    sb = _sb()
    resp = sb.table("store_orders").select("*")        .eq("user_email", email).order("created_at", desc=True).execute()
    return {"orders": resp.data or []}


@app.get("/store/download/{order_id}")
def store_download(order_id: str, email: str = "", product_id: str = ""):
    """Generate download link for digital product."""
    from app.database import _sb
    import json as _json
    sb = _sb()
    resp = sb.table("store_orders").select("*")        .eq("id", order_id).eq("status", "fulfilled").execute()
    if not resp.data: raise HTTPException(404, "Order not found or not fulfilled")
    order = resp.data[0]
    if order["user_email"] != email and not _is_master(email):
        raise HTTPException(403, "Forbidden")
    items = _json.loads(order.get("items","[]"))
    for item in items:
        if (not product_id or item.get("product_id") == product_id) and item.get("file_url"):
            from fastapi.responses import RedirectResponse
            return RedirectResponse(item["file_url"])
    raise HTTPException(404, "No downloadable file in this order")


# ── Bundles ──────────────────────────────────────────────────────

@app.post("/store/bundles")
async def store_set_bundle(req: Request):
    from app.database import _sb
    import json as _json
    body = await req.json()
    if not _is_master(body.get("admin_email","")): raise HTTPException(403, "Master only")
    sb = _sb()
    data = {
        "product_id": body["product_id"],
        "grants":     _json.dumps(body.get("grants",[])),
    }
    # Upsert
    existing = sb.table("store_bundle_grants")        .select("id").eq("product_id", body["product_id"]).execute()
    if existing.data:
        sb.table("store_bundle_grants").update(data)            .eq("product_id", body["product_id"]).execute()
    else:
        sb.table("store_bundle_grants").insert(data).execute()
    return {"ok": True}


@app.get("/health")
def health():
    return {"status":"ok","jobs":len(jobs),
            "samples_per_sec":SAMPLES_PER_SECOND,
            "sample_interval_ms":SAMPLE_INTERVAL_MS,
            "watermark":WATERMARK_TEXT,
            "supabase":SUPABASE_URL[:35]+"..."}