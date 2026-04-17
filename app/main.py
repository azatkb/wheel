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

import uuid, shutil, asyncio, json, logging, math, datetime
from pathlib import Path
from concurrent.futures import ThreadPoolExecutor

import cv2
import numpy as np
from fastapi import FastAPI, UploadFile, File, Form, WebSocket, WebSocketDisconnect, HTTPException
from fastapi.responses import FileResponse, HTMLResponse, StreamingResponse
from fastapi.middleware.cors import CORSMiddleware

from app.config import (
    INPUTS_DIR, OUTPUTS_DIR, SAMPLES_PER_SECOND,
    MAX_GAP_FRAMES, ROI_FACTOR, SMOOTH_N, MIN_PAIR_DIST,
    WHEEL_DIAMETER_MM, SUPABASE_URL,
    TRACK_CIRCLE_COLOR, TRACK_CIRCLE_THICK, TRACK_CIRCLE_GLOW,
    DEFAULT_DIRECTION, DEFAULT_MEDIUM, DEFAULT_HAND, DEFAULT_INFO_LEVEL,
    PREPROCESS_ENABLED,
)
from app.detector import (
    build_ranges, find_blobs, pick_farthest_pair,
    wheel_hub, orange_angle, compute_confidence,
    unwrap, draw_neon_circle,
    detect_yolo, load_yolo,
    make_ellipse_mask, make_inner_ellipse_mask, find_orange_adaptive,
    dome_corrected_center,
    dome_corrected_center,
    MARKER_DEFS, process,
    ORANGE_H_LO, ORANGE_H_HI, ORANGE_S_MIN,
    YOLO_EVERY,
)
from app.physics import (
    detect_phases, calculate, build_csv_row,
    build_user_message, format_si, format_sci,
)
from app.preprocessor import preprocess_video, get_video_info
from app.database import (
    create_job, finish_job, make_sample,
    persist_samples, read_samples, get_csv_path,
    get_user_history, save_physics_result,
)
from app.stabilizer import Stabilizer

logging.basicConfig(level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s - %(message)s")
log = logging.getLogger(__name__)

# ── App settings — change freely ───────────────────────────────────────────

# Watermark text on video
WATERMARK_TEXT = "© enyem.com"

# Default language for user messages: "en" | "hu" | "de"
DEFAULT_LANG = "en"

# User version: "free" | "paid"
# In production set per-user from DB
DEFAULT_VERSION = "free"

# Measurement interval in milliseconds (10–6000)
# Minimum practical value: 33ms (≈30 fps). Lower than 1000/fps has no effect.
SAMPLE_INTERVAL_MS = 1000   # 1000 = once per second

# Outlier threshold — if cumulative rotation > this, flag as suspicious
OUTLIER_THRESHOLD_DEG = 3600  # 10 full rotations

# Default average values used when user has < 2 stored results
# Change these to calibrate the baseline
DEFAULT_AVERAGES = {
    "cumulative_deg":  90.0,
    "omega_max":       0.5,
    "W_total_air":     1e-8,
    "F_max_air":       1e-6,
}

# ── CORS ───────────────────────────────────────────────────────────────────

app = FastAPI(title="Wheel Tracker", version="4.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
    expose_headers=["*"],
)

executor   = ThreadPoolExecutor(max_workers=2)
jobs: dict = {}
_markers   = build_ranges(MARKER_DEFS)
_yolo      = load_yolo()
_TMPL      = Path(__file__).parent / "templates"


# ── Frontend ───────────────────────────────────────────────────────────────

@app.get("/", response_class=HTMLResponse)
async def page_upload():
    return HTMLResponse((_TMPL/"upload.html").read_text(encoding="utf-8"),
                        headers={"Content-Type":"text/html; charset=utf-8"})

@app.get("/stream-test", response_class=HTMLResponse)
async def page_stream():
    return HTMLResponse((_TMPL/"stream.html").read_text(encoding="utf-8"),
                        headers={"Content-Type":"text/html; charset=utf-8"})


# ── Helpers ────────────────────────────────────────────────────────────────

def _add_watermark(frame: np.ndarray, text: str, upload_dt: str) -> np.ndarray:
    """Add watermark text + upload datetime to video frame."""
    h, w = frame.shape[:2]
    font  = cv2.FONT_HERSHEY_SIMPLEX
    scale = max(0.4, w / 1280 * 0.7)
    thick = 1
    color = (200, 200, 200)
    shadow= (0, 0, 0)

    # Bottom-left: watermark
    cv2.putText(frame, text, (10, h-10), font, scale, shadow, thick+1, cv2.LINE_AA)
    cv2.putText(frame, text, (10, h-10), font, scale, color,  thick,   cv2.LINE_AA)

    # Top-right: date
    tw, _ = cv2.getTextSize(upload_dt, font, scale*0.8, thick)[0], 0
    cv2.putText(frame, upload_dt, (w-tw[0]-8, 22), font, scale*0.8, shadow, thick+1, cv2.LINE_AA)
    cv2.putText(frame, upload_dt, (w-tw[0]-8, 22), font, scale*0.8, color,  thick,   cv2.LINE_AA)
    return frame


def _run_physics(samples: list, medium: str, direction: str,
                 user_email: str, job_id: str, version: str, lang: str) -> dict:
    """
    Run physics calculations on detection samples.
    Returns physics result dict + user message.
    """
    if not samples:
        return {}

    # Build time series from samples
    # Use cumulative_deg (not rotation_deg) — rotation_deg wraps 0-360
    # which causes fake velocity spikes at wrap-around points
    timestamps  = [s["timestamp_sec"]       for s in samples]
    angles_rad  = [math.radians(abs(s["cumulative_deg"] or 0)) for s in samples]

    # Detect motion phases — pass direction_filter from user input
    phases = detect_phases(timestamps, angles_rad,
                           direction_filter=direction)

    # Calculate 20 variables × 3 cases
    result = calculate(phases)

    # Store max observed cumulative rotation for user display
    # (phi_total in physics = motion from t_start, max_cum = absolute max seen)
    max_cum_deg = max(abs(s["cumulative_deg"] or 0) for s in samples)
    result["max_cum_deg"] = max_cum_deg

    # Check for outliers
    cum_deg = abs(samples[-1].get("cumulative_deg", 0))
    is_outlier = cum_deg > OUTLIER_THRESHOLD_DEG

    # Get user history for ranking
    history = []
    try:
        history = get_user_history(user_email)
    except Exception:
        pass

    # Use default averages if user has < 2 results
    if len(history) < 2:
        user_avg = DEFAULT_AVERAGES.copy()
    else:
        user_avg = {
            "cumulative_deg": sum(abs(h.get("cumulative_deg",0)) for h in history) / len(history),
            "W_total_air":    sum(h.get("W_total_air",0) for h in history) / len(history),
            "F_max_air":      sum(h.get("F_max_air",0)  for h in history) / len(history),
        }

    # Build user message
    msg_data = build_user_message(
        result  = result,
        medium  = medium,
        version = version,
        lang    = lang,
    )

    # Add ranking vs personal average (paid only)
    if version == "paid" and user_avg:
        val     = cum_deg
        avg_val = user_avg.get("cumulative_deg", val)
        pct     = (val - avg_val) / avg_val * 100 if avg_val else 0
        if pct > 5:
            rank_msg = {"en":"Congrats, You are excellent! 🥇",
                        "hu":"Gratulálok, kiváló vagy! 🥇"}.get(lang,"Congrats! 🥇")
            rank_medal = "gold"
        elif pct >= -5:
            rank_msg = {"en":"Congrats, You are in good shape! 🥈",
                        "hu":"Gratulálok, jó formában vagy! 🥈"}.get(lang,"Good shape! 🥈")
            rank_medal = "silver"
        else:
            rank_msg = {"en":"Congrats, your power works! 🥉",
                        "hu":"Gratulálok, az erőd működik! 🥉"}.get(lang,"Keep going! 🥉")
            rank_medal = "bronze"
        msg_data["rank_message"] = rank_msg
        msg_data["rank_medal"]   = rank_medal
        msg_data["pct_vs_avg"]   = round(pct, 1)

    # Outlier warning
    if is_outlier:
        warn = {"en":"Are you sure this result came out correctly? ⚠️",
                "hu":"Biztos, hogy ez az eredmény helyes? ⚠️"}.get(lang,"Check result ⚠️")
        msg_data["warning"] = warn

    # t_Lajtner and a_Lajtner
    msg_data["t_lajtner_s"]  = round(result.get("t_lajtner", 0), 3)
    msg_data["a_lajtner"]    = format_si(result.get("a_lajtner", 0), "rad/s³")

    # Build CSV row for storage
    now = datetime.datetime.utcnow().strftime("%Y-%m-%d %H:%M:%S")
    csv_row = build_csv_row(
        email              = user_email,
        job_id             = job_id,
        timestamp          = now,
        sample_interval_ms = SAMPLE_INTERVAL_MS,
        medium             = medium,
        phases             = phases,
        result             = result,
    )

    # Save physics to DB
    try:
        save_physics_result(job_id, user_email, medium, result, csv_row)
    except Exception as e:
        log.warning(f"[PHYSICS] save failed: {e}")

    return {
        "phases":    phases,
        "result":    result,
        "message":   msg_data,
        "csv_row":   csv_row,
        "is_outlier": is_outlier,
    }


# ── Upload pipeline ────────────────────────────────────────────────────────

def _run_job(job_id, raw_path, direction, medium, hand_visible,
             info_level, user_email, version, lang):
    try:
        jobs[job_id]["status"]   = "preprocessing"
        jobs[job_id]["progress"] = {"pct":0,"frame":0,"total":0}

        upload_dt = datetime.datetime.utcnow().strftime("%Y.%m.%d.%H.%M")

        # Step 1: Preprocess — resize to 480p, trim 120s, mute
        if PREPROCESS_ENABLED:
            prep = INPUTS_DIR / f"{job_id}_prep.mp4"
            preprocess_video(raw_path, prep)
        else:
            prep = raw_path

        jobs[job_id]["status"] = "processing"
        out = OUTPUTS_DIR / f"{job_id}_tracked.mp4"

        def on_progress(data: dict):
            jobs[job_id]["progress"] = data

        # Step 2: Detect rotation + write annotated video
        samples = process(
            str(prep), str(out),
            job_id     = job_id,
            direction  = direction,
            medium     = medium,
            info_level = info_level,
            progress_cb= on_progress,
            watermark  = WATERMARK_TEXT,
            upload_dt  = upload_dt,
            hand_label = "hand" if hand_visible else "no hand",
        )

        # Step 3: Physics calculations
        jobs[job_id]["status"] = "calculating"
        physics = _run_physics(
            samples    = samples or [],
            medium     = medium,
            direction  = direction,
            user_email = user_email,
            job_id     = job_id,
            version    = version,
            lang       = lang,
        )

        # Step 4: Finish
        finish_job(job_id, len(samples) if samples else 0,
                   samples[-1]["timestamp_sec"] if samples else 0)

        jobs[job_id] = {
            "status":       "done",
            "filename":     out.name,
            "sample_count": len(samples) if samples else 0,
            "url":          f"/download/{job_id}",
            "csv_url":      f"/csv/{job_id}",
            "results_url":  f"/results/{job_id}",
            "physics_url":  f"/physics/{job_id}",
            "message":      physics.get("message", {}),
            "physics":      physics.get("result",  {}),
            "phases":       physics.get("phases",  {}),
            "progress":     {"pct":100},
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
    jobs[job_id] = {"status":"queued","progress":{"pct":0}}
    asyncio.get_event_loop().run_in_executor(
        executor, _run_job, job_id, raw_path,
        direction, medium, hand_visible, info_level,
        user_email, version, lang)
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
    """SSE stream of detection JSON coords — browser draws overlay on canvas."""
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

    return StreamingResponse(gen(),
        media_type="text/event-stream",
        headers={"Cache-Control":"no-cache","X-Accel-Buffering":"no",
                 "Access-Control-Allow-Origin":"*"})


@app.get("/download/{job_id}")
def download(job_id: str):
    info = jobs.get(job_id)
    if not info: raise HTTPException(404,"Not found")
    if info.get("status")!="done": raise HTTPException(400,f"Not done: {info.get('status')}")
    p = OUTPUTS_DIR/info["filename"]
    if not p.exists(): raise HTTPException(500,"File missing")
    return FileResponse(str(p),media_type="video/mp4",filename=p.name)


@app.get("/results/{job_id}")
def results(job_id: str): return read_samples(job_id)


@app.get("/physics/{job_id}")
def physics_results(job_id: str):
    """Return physics calculation results for a job."""
    info = jobs.get(job_id)
    if not info: raise HTTPException(404,"Not found")
    if info.get("status") not in ("done","calculating"):
        raise HTTPException(400,"Not ready")
    return {
        "message":     info.get("message",  {}),
        "result":      info.get("physics",  {}),
        "phases":      info.get("phases",   {}),
        "physics_url": f"/physics/{job_id}",
    }


@app.get("/csv/{job_id}")
def csv_download(job_id: str):
    p = get_csv_path(job_id)
    if not p.exists(): raise HTTPException(404,"CSV not found")
    return FileResponse(str(p),media_type="text/csv",filename=p.name)


@app.get("/jobs")
def list_jobs():
    return {"jobs":{k:{kk:vv for kk,vv in v.items() if kk!="progress"}
                    for k,v in jobs.items()}}


# ── WebSocket stream ───────────────────────────────────────────────────────

@app.websocket("/stream")
async def stream_ws(ws: WebSocket):
    await ws.accept()
    params     = dict(ws.query_params)
    direction  = params.get("direction",  DEFAULT_DIRECTION)
    medium     = params.get("medium",     DEFAULT_MEDIUM)
    info_level = params.get("info_level", DEFAULT_INFO_LEVEL)
    email      = params.get("email",      "")
    job_id     = str(uuid.uuid4())

    create_job(job_id,email,"stream",direction,medium,False,info_level)
    log.info(f"[WS] {ws.client}  job={job_id}")
    # Send job_id to client so it can fetch physics after stream ends
    await ws.send_text(json.dumps({"type":"init","job_id":job_id}))

    rot_prev=None; rot_cum=0.0; rot_buf=[]; zero_offset=None; vel_dps=0.0
    hub_buf=[]; hub_stable=hub_radius=None; hub_source=None
    gap_hub=gap_ora=0; last_hub=last_ora=None; conf_smooth=0.0
    stab=Stabilizer()
    _last_yolo_det={"center":None,"orange":None,"ground":None}
    sample_interval=1.0/SAMPLES_PER_SECOND
    next_sample_at=0.0; all_samples=[]; frame_idx=0; fps_assumed=30.0

    try:
        while True:
            data  = await ws.receive_bytes()
            frame = cv2.imdecode(np.frombuffer(data,np.uint8),cv2.IMREAD_COLOR)
            if frame is None:
                await ws.send_text(json.dumps({"error":"bad frame"})); continue

            h,w=frame.shape[:2]; max_y=int(h*0.90); t_sec=frame_idx/fps_assumed
            frame_s=stab.stabilize(frame)
            preproc=cv2.bilateralFilter(frame_s,7,50,50)
            hsv=cv2.cvtColor(preproc,cv2.COLOR_BGR2HSV)

            if frame_idx%YOLO_EVERY==0:
                _last_yolo_det=detect_yolo(_yolo,preproc,hsv)
            yolo_det=_last_yolo_det

            # Build ellipse mask from ground bbox
            if yolo_det.get("ground") is not None:
                gx,gy,gw,gh = yolo_det["ground"]
                ellipse_mask = make_ellipse_mask(hsv.shape, gx, gy, gw, gh)
                inner_mask, _ = make_inner_ellipse_mask(hsv.shape, gx, gy, gw, gh)
                hsv_src = cv2.bitwise_and(hsv, hsv, mask=ellipse_mask)
            elif hub_stable is not None and hub_radius is not None:
                roi=np.zeros(hsv.shape[:2],np.uint8)
                cv2.circle(roi,(int(hub_stable[0]),int(hub_stable[1])),int(hub_radius*1.15),255,-1)
                hsv_src=cv2.bitwise_and(hsv,hsv,mask=roi)
                inner_mask=roi
            else:
                hsv_src=hsv
                inner_mask=None

            # Orange: OpenCV adaptive first, YOLO fallback
            if inner_mask is not None:
                _cv_ora_blob = find_orange_adaptive(hsv, inner_mask, last_ora)
                if _cv_ora_blob is None:
                    _hsv_inner = cv2.bitwise_and(hsv, hsv, mask=inner_mask)
                    _list = find_blobs(_hsv_inner, _markers["ORANGE"], max_y)
                    _cv_ora_blob = _list[0] if _list else None
                cv_ora = [_cv_ora_blob] if _cv_ora_blob is not None else []
            else:
                cv_ora = find_blobs(hsv_src, _markers["ORANGE"], max_y)

            # Hub: dome-corrected ground center first (priority 1), then YOLO center
            hub_px_raw=None
            if yolo_det.get("ground") is not None:
                ecx, ecy = dome_corrected_center(gx, gy, gw, gh, w, h)
                hub_px_raw=(ecx, ecy); hub_source="GROUND"
                gap_hub=0; last_hub=hub_px_raw
            if yolo_det["center"] is not None:
                cx,cy,_,_,_=yolo_det["center"]
                hub_px_raw=(float(cx),float(cy)); hub_source="YOLO"
                gap_hub=0; last_hub=hub_px_raw
            if hub_px_raw is None and gap_hub<MAX_GAP_FRAMES and last_hub:
                gap_hub+=1; hub_px_raw=last_hub

            # Orange selection: OpenCV first, YOLO fallback
            if cv_ora:
                ora_blob=cv_ora[0]; gap_ora=0; last_ora=ora_blob
            elif yolo_det["orange"] is not None:
                ora_blob=yolo_det["orange"]; gap_ora=0; last_ora=ora_blob
            elif gap_ora<MAX_GAP_FRAMES and last_ora:
                gap_ora+=1; ora_blob=last_ora
            else:
                gap_ora=min(gap_ora+1,MAX_GAP_FRAMES+1); ora_blob=None

            has_hub=hub_px_raw is not None; has_orange=ora_blob is not None

            if has_hub:
                hub_buf.append(np.array(hub_px_raw))
                if len(hub_buf)>30: hub_buf.pop(0)
                hub_stable=np.mean(hub_buf,axis=0)
                if has_orange:
                    hub_radius=max(hub_radius or 0,
                                   math.hypot(ora_blob[0]-hub_stable[0],
                                              ora_blob[1]-hub_stable[1])*1.3)

            rot_raw=None
            if has_hub and has_orange:
                rot_raw=orange_angle(ora_blob,hub_px_raw)
            if rot_raw is not None and zero_offset is None:
                zero_offset=rot_raw
            rot_z=((rot_raw-zero_offset)%360
                   if rot_raw is not None and zero_offset is not None else None)

            if rot_z is not None:
                rot_buf.append(rot_z)
                if len(rot_buf)>SMOOTH_N: rot_buf.pop(0)
                rot_smooth=math.degrees(math.atan2(
                    np.mean([math.sin(math.radians(x)) for x in rot_buf]),
                    np.mean([math.cos(math.radians(x)) for x in rot_buf])))%360
            else:
                rot_smooth=rot_buf[-1] if rot_buf else None

            if rot_smooth is not None:
                if rot_prev is not None: rot_cum=unwrap(rot_prev,rot_smooth,rot_cum)
                rot_prev=rot_smooth

            if len(rot_buf)>=2:
                d=rot_buf[-1]-rot_buf[-2]
                if d>180: d-=360
                if d<-180: d+=360
                vel_dps=d*fps_assumed

            conf=compute_confidence(has_hub,has_orange,hub_source or "")
            conf_smooth=conf_smooth*0.6+conf*0.4; conf_disp=int(round(conf_smooth))

            if t_sec>=next_sample_at:
                all_samples.append(make_sample(
                    job_id=job_id,timestamp_sec=t_sec,rotation_deg=rot_smooth,
                    cumulative_deg=-rot_cum,angular_vel_dps=-vel_dps,
                    confidence_pct=conf_disp,source=hub_source))
                next_sample_at+=sample_interval
                if len(all_samples)%20==0:
                    persist_samples(job_id,all_samples[-20:])

            await ws.send_text(json.dumps({
                "frame":           frame_idx,
                "rotation_deg":    round(rot_smooth,2) if rot_smooth is not None else None,
                "rotation_rad":    round(math.radians(rot_smooth),5) if rot_smooth is not None else None,
                "cumulative_deg":  round(-rot_cum,2),
                "cumulative_rad":  round(math.radians(-rot_cum),5),
                "angular_vel_dps": round(-vel_dps,2),
                "angular_vel_rps": round(math.radians(-vel_dps),5),
                "confidence_pct":  conf_disp,
                "hub":             [round(hub_px_raw[0]),round(hub_px_raw[1])] if hub_px_raw else None,
                "hub_px":          [round(hub_px_raw[0]),round(hub_px_raw[1])] if hub_px_raw else None,
                "orange":          [ora_blob[0],ora_blob[1],ora_blob[4]] if ora_blob else None,
                "ground":          list(yolo_det["ground"]) if yolo_det.get("ground") else None,
                "vid_w":           w,
                "vid_h":           h,
                "source":          hub_source,
                "hub_source":      hub_source,
            }))
            frame_idx+=1

    except WebSocketDisconnect:
        log.info(f"[WS] disconnected after {frame_idx} frames")
    except Exception as exc:
        log.error(f"[WS] error: {exc}",exc_info=True)
        try: await ws.send_text(json.dumps({"error":str(exc)}))
        except: pass
    finally:
        rem=len(all_samples)%20
        if rem: persist_samples(job_id,all_samples[-rem:])
        finish_job(job_id,len(all_samples),
                   all_samples[-1]["timestamp_sec"] if all_samples else 0)
        # Run physics on stream data and store in jobs for /physics/{id}
        if all_samples:
            try:
                stream_params = dict(ws.query_params) if hasattr(ws,'query_params') else {}
                stream_medium = stream_params.get("medium", DEFAULT_MEDIUM)
                stream_dir    = stream_params.get("direction", DEFAULT_DIRECTION)
                stream_ver    = stream_params.get("version", DEFAULT_VERSION)
                stream_lang   = stream_params.get("lang", DEFAULT_LANG)
                stream_email  = stream_params.get("email", "")
                physics = _run_physics(
                    samples    = all_samples,
                    medium     = stream_medium,
                    direction  = stream_dir,
                    user_email = stream_email,
                    job_id     = job_id,
                    version    = stream_ver,
                    lang       = stream_lang,
                )
                jobs[job_id] = {
                    "status":      "done",
                    "sample_count": len(all_samples),
                    "message":     physics.get("message", {}),
                    "physics":     physics.get("result",  {}),
                    "phases":      physics.get("phases",  {}),
                    "physics_url": f"/physics/{job_id}",
                }
            except Exception as e:
                log.warning(f"[WS] physics failed: {e}")


@app.get("/health")
def health():
    return {"status":"ok","jobs":len(jobs),
            "samples_per_sec":SAMPLES_PER_SECOND,
            "sample_interval_ms":SAMPLE_INTERVAL_MS,
            "watermark":WATERMARK_TEXT,
            "supabase":SUPABASE_URL[:35]+"..."}