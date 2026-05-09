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
WATERMARK_TEXT       = "LaJTNeR.com"
MAX_ANGLE_JUMP       = 30.0   # degrees — reject spoke-hop jumps
DEFAULT_LANG         = "en"
DEFAULT_VERSION      = "free"
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
    if version == "paid" and user_avg:
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
    if version == "paid":
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

    fourcc  = cv2.VideoWriter_fourcc(*"mp4v")
    out_vid = cv2.VideoWriter(str(out_path), fourcc, fps, (W, H + BAR_HEIGHT))
    if not out_vid.isOpened():
        log.warning(f"[VIDEO] VideoWriter failed to open: {out_path}, trying avc1")
        fourcc  = cv2.VideoWriter_fourcc(*"avc1")
        out_vid = cv2.VideoWriter(str(out_path), fourcc, fps, (W, H + BAR_HEIGHT))
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


        # Watermark - top right
        _wm = WATERMARK_TEXT
        _wm_scale = max(0.45, W/1280*0.65)
        _wm_thick = max(1, int(W/640))
        (wm_w, wm_h), _ = cv2.getTextSize(_wm, cv2.FONT_HERSHEY_SIMPLEX, _wm_scale, _wm_thick)
        _wx = W - wm_w - 10
        _wy = wm_h + 10
        cv2.putText(ann, _wm, (_wx, _wy), cv2.FONT_HERSHEY_SIMPLEX,
                    _wm_scale, (0,0,0), _wm_thick+1, cv2.LINE_AA)
        cv2.putText(ann, _wm, (_wx, _wy), cv2.FONT_HERSHEY_SIMPLEX,
                    _wm_scale, (220,220,220), _wm_thick, cv2.LINE_AA)
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
                "t_sec": round(t_sec, 2), "vid_w": W, "vid_h": H,
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
    out_vid.release()

    # Re-encode to H.264 for Android/Chrome compatibility using imageio
    try:
        import imageio
        import imageio.v3 as iio
        _tmp = out_path.with_suffix(".tmp.mp4")
        # Read all frames from OpenCV output
        reader = imageio.get_reader(str(out_path))
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
            _tmp.replace(out_path)
            log.info(f"[VIDEO] Re-encoded to H.264 via imageio: {out_path}")
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
        if status == "paid" or sub_status == "complete":
            cust_email = getattr(session, "customer_email", "") or email
            if cust_email:
                from app.database import _sb
                sb = _sb()
                sb.table("wt_users").update({"plan":"paid"}).eq("email", cust_email.lower()).execute()
                log.info(f"[STRIPE] plan updated via check-session for {cust_email}")
            return {"ok": True, "plan": "paid", "status": sub_status}
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
        # Stripe objects use attribute access, not .get()
        try:
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
                sb.table("wt_users").update({"plan": "paid"}).eq("email", email.lower()).execute()
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
                sb.table("wt_users").update({"plan": "free"}).eq("email", email.lower()).execute()
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
        sb.table("wt_users").update({"plan": "free"}).eq("email", email).execute()
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
    if not email or not password:
        raise HTTPException(400, "Email and password required")
    if _get_user(email):
        raise HTTPException(409, "Email already registered")
    try:
        from app.database import _sb
        sb = _sb()
        sb.table("wt_users").insert({
            "email": email,
            "password_hash": _hash_pw(password),
            "plan": "free",
            "created_at": datetime.datetime.utcnow().isoformat(),
        }).execute()
        return {"ok": True}
    except Exception as e:
        raise HTTPException(500, str(e))

@app.post("/auth/plan")
async def auth_update_plan(request: Request):
    body = await request.json()
    email = (body.get("email") or "").strip().lower()
    plan  = (body.get("plan") or "free").strip().lower()
    if plan not in ("free", "paid"):
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
    user = _get_user(email)
    if not user or user.get("password_hash") != _hash_pw(password):
        raise HTTPException(401, "Invalid email or password")
    token = secrets.token_hex(32)
    return {"token": token, "email": email, "plan": user.get("plan", "free")}

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
                msg  = {
                    "t_lajtner_s": row.get("t_lajtner", 0),
                    "a_lajtner":   row.get("a_lajtner", 0),
                }
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

    _sp = {
        "direction": params.get("direction", DEFAULT_DIRECTION),
        "medium":    params.get("medium",    DEFAULT_MEDIUM),
        "email":     email,
        "version":   params.get("version",   DEFAULT_VERSION),
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

@app.get("/master/all")
def master_all(token: str = "", limit: int = 1000):
    """Master: read all physics results from all users."""
    if token != MASTER_TOKEN:
        raise HTTPException(401, "Unauthorized")
    rows = get_master_data(limit=limit)
    return {"count": len(rows), "rows": rows}

@app.get("/master/export-csv")
def master_export_csv(token: str = ""):
    """Master: export all data to CSV for Excel."""
    if token != MASTER_TOKEN:
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
    if plan not in ("free", "paid"):
        raise HTTPException(400, "plan must be 'free' or 'paid'")
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
def master_users(token: str = ""):
    """Master: list all unique users with measurement counts."""
    if token != MASTER_TOKEN:
        raise HTTPException(401, "Unauthorized")
    rows = get_master_data(limit=10000)
    from collections import defaultdict
    users = defaultdict(int)
    for r in rows:
        users[r.get("email","?")] += 1
    return {"users": [{"email": e, "count": c} for e,c in sorted(users.items())]}

@app.get("/bar-data/{email}")
def bar_data(email: str, token: str = ""):
    """Return bar chart data: last2 + user_avg + group_avg."""
    data = get_user_bar_data(email)
    return data

@app.post("/admin/rerun-physics/{job_id}")
async def rerun_physics(job_id: str, medium: str = "air", version: str = "free",
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

@app.get("/health")
def health():
    return {"status":"ok","jobs":len(jobs),
            "samples_per_sec":SAMPLES_PER_SECOND,
            "sample_interval_ms":SAMPLE_INTERVAL_MS,
            "watermark":WATERMARK_TEXT,
            "supabase":SUPABASE_URL[:35]+"..."}