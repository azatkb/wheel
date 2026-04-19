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

import uuid, os, shutil, asyncio, json, logging, math, datetime
from pathlib import Path
from concurrent.futures import ThreadPoolExecutor

import cv2
import numpy as np
from fastapi import FastAPI, UploadFile, File, Form, WebSocket, WebSocketDisconnect, HTTPException
from fastapi.responses import FileResponse, HTMLResponse, StreamingResponse
from fastapi.middleware.cors import CORSMiddleware

from app.config import (
    INPUTS_DIR, OUTPUTS_DIR, SAMPLES_PER_SECOND,
    SUPABASE_URL, BAR_HEIGHT,
    DEFAULT_DIRECTION, DEFAULT_MEDIUM, DEFAULT_HAND, DEFAULT_INFO_LEVEL,
    PREPROCESS_ENABLED,
)
from app.detector_seg import (
    load_yolo_seg, detect_seg,
    find_spoke_tips, find_orange_tip,
    orange_angle, unwrap,
    draw_seg_overlay,
    YOLO_EVERY, SMOOTH_N as SEG_SMOOTH_N,
)
from app.physics import (
    detect_phases, calculate, build_csv_row,
    build_user_message, format_si, format_sci,
)
from app.preprocessor import preprocess_video, get_video_info
from app.database import (
    create_job, finish_job, make_sample,
    persist_samples, read_samples, get_csv_path,
    get_user_history, save_physics_result, get_all_jobs,
)
from app.stabilizer import Stabilizer

logging.basicConfig(level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s - %(message)s")
log = logging.getLogger(__name__)

# ── App settings ───────────────────────────────────────────────────────────
WATERMARK_TEXT       = "© enyem.com"
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
    angles_rad = [math.radians(abs(s["cumulative_deg"] or 0)) for s in samples]
    phases = detect_phases(timestamps, angles_rad, direction_filter=direction)
    result = calculate(phases)
    max_cum_deg = max(abs(s["cumulative_deg"] or 0) for s in samples)
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
            "cumulative_deg": sum(abs(h.get("cumulative_deg",0)) for h in history)/len(history),
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
    try:
        save_physics_result(job_id, user_email, medium, result, csv_row)
    except Exception as e:
        log.warning(f"[PHYSICS] save failed: {e}")
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
    _last_hub   = None
    _last_contour = None
    _last_tips  = []

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
            mask, hub, contour, conf, bbox = detect_seg(_seg, preproc)
            if mask is not None:
                _last_mask    = mask
                _last_hub     = hub
                _last_contour = contour
                _last_tips    = find_spoke_tips(mask, hub)

        hub      = _last_hub
        tips     = _last_tips
        contour  = _last_contour
        mask     = _last_mask
        has_hub  = hub is not None

        ora_blob = find_orange_tip(hsv, tips, hub, last_ora) if has_hub else None
        if ora_blob is not None:
            last_ora = ora_blob
            has_orange = True
        elif last_ora is not None:
            ora_blob = last_ora
            has_orange = True
        else:
            has_orange = False

        rot_raw = None
        if has_hub and has_orange:
            rot_raw = orange_angle(ora_blob, hub)
        if rot_raw is not None and zero_offset is None:
            zero_offset = rot_raw
        rot_z = ((rot_raw - zero_offset) % 360
                 if rot_raw is not None and zero_offset is not None else None)
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
            rot_smooth = math.degrees(math.atan2(
                np.mean([math.sin(math.radians(x)) for x in rot_buf]),
                np.mean([math.cos(math.radians(x)) for x in rot_buf]))) % 360
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
        draw_seg_overlay(ann, mask, hub, contour, tips, ora_blob, rot_smooth, rot_cum, bbox)

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
        # Source
        if hub is not None:
            cv2.putText(bar,"Hub: SEG",(col2,118),cv2.FONT_HERSHEY_SIMPLEX,0.40,WHITE,1)
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
        if watermark:
            cv2.putText(ann,watermark,(8,H-8),cv2.FONT_HERSHEY_SIMPLEX,
                        max(0.4,W/1280*0.7),(0,0,0),2,cv2.LINE_AA)
            cv2.putText(ann,watermark,(8,H-8),cv2.FONT_HERSHEY_SIMPLEX,
                        max(0.4,W/1280*0.7),(200,200,200),1,cv2.LINE_AA)
        # Write frame + bar
        if ann.shape[1] != W or ann.shape[0] != H:
            ann = cv2.resize(ann, (W, H))
        out_vid.write(np.vstack([ann, bar]))

        # Sample
        if t_sec >= next_sample_at:
            conf_disp = 100 if has_orange else (60 if has_hub else 0)
            all_samples.append(make_sample(
                job_id=job_id, timestamp_sec=t_sec,
                rotation_deg=rot_smooth, cumulative_deg=-rot_cum,
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
                "rotation_deg": round(rot_smooth, 1) if rot_smooth else None,
                "cumulative_deg": round(-rot_cum, 1),
                "confidence_pct": 100 if has_orange else (60 if has_hub else 0),
            })
        fi += 1

    cap.release()
    out_vid.release()
    rem = len(all_samples) % 20
    if rem: persist_samples(job_id, all_samples[-rem:])
    log.info(f"[VIDEO] done — {len(all_samples)} samples → {out_path}")
    return all_samples

# ── Upload pipeline ────────────────────────────────────────────────────────
def _run_job(job_id, raw_path, direction, medium, hand_visible,
             info_level, user_email, version, lang):
    try:
        jobs[job_id]["status"]   = "preprocessing"
        jobs[job_id]["progress"] = {"pct":0,"frame":0,"total":0}
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
    info = jobs.get(job_id, {})
    # Try memory first (fast)
    if info.get("physics") or info.get("message"):
        return {"message": info.get("message", {}),
                "result":  info.get("physics",  {}),
                "phases":  info.get("phases",   {}),
                "physics_url": f"/physics/{job_id}"}
    # Fallback: read from Supabase via _sb()
    try:
        from app.database import _sb
        sb = _sb()
        if sb:
            resp = sb.table("physics_results").select(
                "physics_json"
            ).eq("job_id", job_id).limit(1).execute()
            if resp.data:
                phys = json.loads(resp.data[0].get("physics_json") or "{}")
                return {"message": {}, "result": phys,
                        "phases": {}, "physics_url": f"/physics/{job_id}"}
    except Exception as e:
        log.warning(f"[PHYSICS] DB read: {e}")
    raise HTTPException(404, "Physics not found")

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
    params    = dict(ws.query_params)
    direction = params.get("direction",  DEFAULT_DIRECTION)
    medium    = params.get("medium",     DEFAULT_MEDIUM)
    email     = params.get("email",      "")
    job_id    = str(uuid.uuid4())

    # Save params now — ws.query_params may be unavailable after disconnect
    _sp = {
        "direction": direction,
        "medium":    medium,
        "email":     email,
        "version":   params.get("version", DEFAULT_VERSION),
        "lang":      params.get("lang",    DEFAULT_LANG),
    }
    create_job(job_id, email, "stream", direction, medium, False, "basic")
    jobs[job_id] = {"status":"streaming", "user_email": email,
                    "source_type": "stream",
                    "created_at": datetime.datetime.utcnow().isoformat(),
                    "progress": {"pct":0}}
    log.info(f"[WS] {ws.client}  job={job_id}")
    await ws.send_text(json.dumps({"type":"init","job_id":job_id}))

    # ── State ──────────────────────────────────────────────────────────────
    rot_prev    = None
    rot_cum     = 0.0
    rot_buf     = []
    zero_offset = None
    vel_dps     = 0.0
    last_ora    = None
    conf_smooth = 0.0
    stab        = Stabilizer()
    fps_assumed  = 5.0
    frame_times  = []    # real arrival timestamps
    frame_buffer = []    # store raw frames, write video after stream ends

    # Video recording
    out_path    = OUTPUTS_DIR / f"{job_id}_stream.mp4"
    out_vid     = None

    # Seg cache — run every YOLO_EVERY frames
    _last_mask    = None
    _last_hub     = None
    _last_contour = None
    _last_tips    = []
    _last_bbox    = None
    _no_mask_frames = 0          # consecutive frames without mask
    NO_MASK_RESET   = 10         # reset angle after this many frames without mask

    sample_interval = 1.0 / SAMPLES_PER_SECOND
    next_sample_at  = 0.0
    all_samples     = []
    frame_idx       = 0

    try:
        while True:
            data  = await ws.receive_bytes()
            frame = cv2.imdecode(np.frombuffer(data, np.uint8), cv2.IMREAD_COLOR)
            if frame is None:
                await ws.send_text(json.dumps({"error":"bad frame"})); continue

            h, w   = frame.shape[:2]
            import time as _time
            frame_times.append(_time.monotonic())
            # Compute real FPS from last N frames
            if len(frame_times) > 20: frame_times.pop(0)
            if len(frame_times) >= 2:
                elapsed = frame_times[-1] - frame_times[0]
                fps_assumed = max(1.0, (len(frame_times)-1) / elapsed) if elapsed > 0 else fps_assumed
            t_sec  = frame_idx / fps_assumed
            frame_s = stab.stabilize(frame)
            preproc = cv2.bilateralFilter(frame_s, 7, 50, 50)
            hsv     = cv2.cvtColor(preproc, cv2.COLOR_BGR2HSV)

            # ── Buffer first frame size ───────────────────────────────────
            if out_vid is None:
                _stream_w, _stream_h = w, h

            # ── Seg detection every YOLO_EVERY frames ──────────────────────
            if frame_idx % YOLO_EVERY == 0:
                mask, hub, contour, conf, bbox = detect_seg(_seg, preproc)
                if mask is not None:
                    _last_mask    = mask
                    _last_hub     = hub
                    _last_contour = contour
                    _last_tips    = find_spoke_tips(mask, hub)
                    _last_bbox    = bbox
                else:
                    # No detection — clear cache, no gap fill
                    _last_mask = None; _last_hub = None
                    _last_contour = None; _last_tips = []; _last_bbox = None

            # ── No mask → count consecutive misses, maybe reset ───────────
            if _last_mask is None:
                _no_mask_frames += 1
                if _no_mask_frames >= NO_MASK_RESET:
                    # Reset all detection state — wheel left frame
                    rot_prev=None; rot_cum=0.0; rot_buf=[]
                    zero_offset=None; vel_dps=0.0
                    last_ora=None; conf_smooth=0.0
                await ws.send_text(json.dumps({
                    "frame": frame_idx, "no_ground": True,
                    "hint":  "Place wheel in frame, camera above",
                    "confidence_pct": 0,
                    "hub": None, "orange": None, "ground": None,
                    "rotation_deg": None,
                    "cumulative_deg": round(-rot_cum, 2),
                    "angular_vel_dps": 0, "vid_w": w, "vid_h": h,
                }))
                frame_idx += 1
                continue
            _no_mask_frames = 0  # mask found — reset counter

            hub     = _last_hub
            tips    = _last_tips

            # ── Orange: find at spoke tips ──────────────────────────────────
            ora_blob = find_orange_tip(hsv, tips, hub, last_ora)
            if ora_blob is not None:
                last_ora = ora_blob
                has_orange = True
            else:
                # No gap fill for orange — only use fresh detection
                has_orange = False
                ora_blob   = None

            # ── Angle math ─────────────────────────────────────────────────
            rot_raw = None
            if hub is not None and has_orange:
                rot_raw = orange_angle(ora_blob, hub)

            if rot_raw is not None and zero_offset is None:
                zero_offset = rot_raw

            rot_z = ((rot_raw - zero_offset) % 360
                     if rot_raw is not None and zero_offset is not None else None)

            if rot_z is not None:
                rot_buf.append(rot_z)
                if len(rot_buf) > SEG_SMOOTH_N: rot_buf.pop(0)
                rot_smooth = math.degrees(math.atan2(
                    np.mean([math.sin(math.radians(x)) for x in rot_buf]),
                    np.mean([math.cos(math.radians(x)) for x in rot_buf]))) % 360
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
                vel_dps = d * fps_assumed

            # ── Confidence ─────────────────────────────────────────────────
            conf = 100 if has_orange else 60
            conf_smooth = conf_smooth * 0.6 + conf * 0.4
            conf_disp   = int(round(conf_smooth))

            # ── Sample ─────────────────────────────────────────────────────
            if t_sec >= next_sample_at:
                all_samples.append(make_sample(
                    job_id=job_id, timestamp_sec=t_sec,
                    rotation_deg=rot_smooth,
                    cumulative_deg=-rot_cum,
                    angular_vel_dps=-vel_dps,
                    confidence_pct=conf_disp,
                    source="SEG",
                ))
                next_sample_at += sample_interval
                if len(all_samples) % 20 == 0:
                    persist_samples(job_id, all_samples[-20:])

            # ── Buffer frame for later video write ────────────────────────
            frame_buffer.append(frame_s.copy())

            # ── Send ───────────────────────────────────────────────────────
            hub_px = [round(hub[0]), round(hub[1])] if hub else None
            await ws.send_text(json.dumps({
                "frame":           frame_idx,
                "rotation_deg":    round(rot_smooth, 2) if rot_smooth is not None else None,
                "rotation_rad":    round(math.radians(rot_smooth), 5) if rot_smooth is not None else None,
                "cumulative_deg":  round(-rot_cum, 2),
                "cumulative_rad":  round(math.radians(-rot_cum), 5),
                "angular_vel_dps": round(-vel_dps, 2),
                "angular_vel_rps": round(math.radians(-vel_dps), 5),
                "confidence_pct":  conf_disp,
                "hub":             hub_px,
                "hub_px":          hub_px,
                "orange":          [ora_blob[0], ora_blob[1], ora_blob[4]] if ora_blob else None,
                "no_orange":       not has_orange,
                "ground":          None,   # no ground bbox in seg mode
                "vid_w":           w,
                "vid_h":           h,
                "source":          "SEG",
                "hub_source":      "SEG",
            }))
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
        rem = len(all_samples) % 20
        if rem: persist_samples(job_id, all_samples[-rem:])
        finish_job(job_id, len(all_samples),
                   all_samples[-1]["timestamp_sec"] if all_samples else 0)
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