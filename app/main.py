"""
main.py
=======
FastAPI server.

  GET  /                    Upload UI
  GET  /stream-test         Live stream UI
  POST /upload              Upload video + job params
  GET  /status/{id}         Poll job
  GET  /download/{id}       Download processed video
  GET  /results/{id}        JSON samples
  GET  /csv/{id}            Download CSV
  WS   /stream              Real-time frame detection
  GET  /health

Run:
  uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
"""

import uuid, shutil, asyncio, json, logging, math
from pathlib import Path
from concurrent.futures import ThreadPoolExecutor

import cv2
import numpy as np
from fastapi import FastAPI, UploadFile, File, Form, WebSocket, WebSocketDisconnect, HTTPException
from fastapi.responses import FileResponse, HTMLResponse
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
    MARKER_DEFS, process,
    ORANGE_H_LO, ORANGE_H_HI, ORANGE_S_MIN,
)
from app.preprocessor import preprocess_video, get_video_info
from app.database import (
    create_job, finish_job, make_sample,
    persist_samples, read_samples, get_csv_path,
)
from app.stabilizer import Stabilizer

logging.basicConfig(level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s - %(message)s")
log = logging.getLogger(__name__)

app = FastAPI(title="Wheel Tracker", version="3.0")
app.add_middleware(CORSMiddleware, allow_origins=["*"],
                   allow_methods=["*"], allow_headers=["*"])

executor    = ThreadPoolExecutor(max_workers=2)
jobs: dict  = {}
_markers    = build_ranges(MARKER_DEFS)
_yolo       = load_yolo()
_TMPL       = Path(__file__).parent / "templates"


# ── Frontend pages ─────────────────────────────────────────────────────────

@app.get("/", response_class=HTMLResponse)
async def page_upload():
    return HTMLResponse(
        (_TMPL / "upload.html").read_text(encoding="utf-8"),
        headers={"Content-Type": "text/html; charset=utf-8"})

@app.get("/stream-test", response_class=HTMLResponse)
async def page_stream():
    return HTMLResponse(
        (_TMPL / "stream.html").read_text(encoding="utf-8"),
        headers={"Content-Type": "text/html; charset=utf-8"})


# ── REST upload pipeline ───────────────────────────────────────────────────

def _run_job(job_id, raw_path, direction, medium, hand_visible, info_level):
    try:
        jobs[job_id]["status"] = "preprocessing"
        if PREPROCESS_ENABLED:
            prep = INPUTS_DIR / f"{job_id}_prep.mp4"
            preprocess_video(raw_path, prep)
        else:
            prep = raw_path

        jobs[job_id]["status"] = "processing"
        out = OUTPUTS_DIR / f"{job_id}_tracked.mp4"
        samples = process(
            str(prep), str(out), job_id=job_id,
            direction=direction, medium=medium, info_level=info_level,
        )

        finish_job(job_id, len(samples) if samples else 0,
                   samples[-1]["timestamp_sec"] if samples else 0)

        jobs[job_id] = {
            "status":       "done",
            "filename":     out.name,
            "sample_count": len(samples) if samples else 0,
            "url":          f"/download/{job_id}",
            "csv_url":      f"/csv/{job_id}",
            "results_url":  f"/results/{job_id}",
        }
        log.info(f"[{job_id}] done — {len(samples) if samples else 0} samples")

    except Exception as exc:
        log.error(f"[{job_id}] failed: {exc}", exc_info=True)
        jobs[job_id] = {"status": "error", "detail": str(exc)}


@app.post("/upload")
async def upload(
    file:         UploadFile = File(...),
    user_email:   str  = Form(default=""),
    direction:    str  = Form(default=DEFAULT_DIRECTION),
    medium:       str  = Form(default=DEFAULT_MEDIUM),
    hand_visible: bool = Form(default=DEFAULT_HAND),
    info_level:   str  = Form(default=DEFAULT_INFO_LEVEL),
):
    suffix = Path(file.filename).suffix.lower()
    if suffix not in (".mp4",".avi",".mov",".mkv",".webm"):
        raise HTTPException(400, f"Unsupported: {suffix}")

    job_id   = str(uuid.uuid4())
    raw_path = INPUTS_DIR / f"{job_id}{suffix}"

    with open(raw_path, "wb") as f:
        shutil.copyfileobj(file.file, f)

    info = get_video_info(raw_path)
    create_job(job_id, user_email, "upload", direction, medium,
               hand_visible, info_level)
    jobs[job_id] = {"status": "queued"}

    asyncio.get_event_loop().run_in_executor(
        executor, _run_job, job_id, raw_path,
        direction, medium, hand_visible, info_level
    )

    return {"job_id": job_id, "status": "queued",
            "status_url": f"/status/{job_id}", "video_info": info}


@app.get("/status/{job_id}")
def status(job_id: str):
    info = jobs.get(job_id)
    if not info: raise HTTPException(404, "Not found")
    return info


@app.get("/download/{job_id}")
def download(job_id: str):
    info = jobs.get(job_id)
    if not info: raise HTTPException(404, "Not found")
    if info.get("status") != "done":
        raise HTTPException(400, f"Not done: {info.get('status')}")
    p = OUTPUTS_DIR / info["filename"]
    if not p.exists(): raise HTTPException(500, "File missing")
    return FileResponse(str(p), media_type="video/mp4", filename=p.name)


@app.get("/results/{job_id}")
def results(job_id: str):
    return read_samples(job_id)


@app.get("/csv/{job_id}")
def csv_download(job_id: str):
    p = get_csv_path(job_id)
    if not p.exists(): raise HTTPException(404, "CSV not found")
    return FileResponse(str(p), media_type="text/csv", filename=p.name)


@app.get("/jobs")
def list_jobs():
    return {"jobs": jobs}


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

    create_job(job_id, email, "stream", direction, medium, False, info_level)
    log.info(f"[WS] {ws.client}  job={job_id}")

    rot_prev    = None
    rot_cum     = 0.0
    rot_buf     = []
    zero_offset = None
    vel_dps     = 0.0

    hub_buf     = []
    hub_stable  = hub_radius = None
    hub_source  = None

    gap_hub     = gap_ora = 0
    last_hub    = last_ora = None

    conf_smooth = 0.0
    stab        = Stabilizer()

    sample_interval = 1.0 / SAMPLES_PER_SECOND
    next_sample_at  = 0.0
    all_samples     = []
    frame_idx       = 0
    fps_assumed     = 30.0

    try:
        while True:
            data  = await ws.receive_bytes()
            frame = cv2.imdecode(np.frombuffer(data, np.uint8), cv2.IMREAD_COLOR)
            if frame is None:
                await ws.send_text(json.dumps({"error": "bad frame"}))
                continue

            h, w  = frame.shape[:2]
            max_y = int(h * 0.90)
            t_sec = frame_idx / fps_assumed

            frame_s = stab.stabilize(frame)
            preproc = cv2.bilateralFilter(frame_s, 7, 50, 50)
            hsv     = cv2.cvtColor(preproc, cv2.COLOR_BGR2HSV)

            # ROI
            if hub_stable is not None and hub_radius is not None:
                roi = np.zeros(hsv.shape[:2], np.uint8)
                cv2.circle(roi, (int(hub_stable[0]),int(hub_stable[1])),
                           int(hub_radius*1.15), 255, -1)
                hsv_src = cv2.bitwise_and(hsv, hsv, mask=roi)
            else:
                hsv_src = hsv

            # ── YOLO ──────────────────────────────────────────────────────
            yolo_det = detect_yolo(_yolo, preproc, hsv)

            # ── OpenCV orange fallback ─────────────────────────────────────
            cv_ora = find_blobs(hsv_src, _markers["ORANGE"], max_y)

            # ── Hub: YOLO center >> gap fill ───────────────────────────────
            hub_px_raw = None
            if yolo_det["center"] is not None:
                cx,cy,_,_,_ = yolo_det["center"]
                hub_px_raw  = (float(cx), float(cy))
                hub_source  = "YOLO"
                gap_hub     = 0
                last_hub    = hub_px_raw
            elif gap_hub < MAX_GAP_FRAMES and last_hub:
                gap_hub    += 1
                hub_px_raw  = last_hub

            # ── Orange: YOLO >> OpenCV >> gap fill ─────────────────────────
            if yolo_det["orange"] is not None:
                ora_blob = yolo_det["orange"]
                gap_ora  = 0; last_ora = ora_blob
            elif cv_ora:
                ora_blob = cv_ora[0]
                gap_ora  = 0; last_ora = ora_blob
            elif gap_ora < MAX_GAP_FRAMES and last_ora:
                gap_ora += 1; ora_blob = last_ora
            else:
                gap_ora  = min(gap_ora+1, MAX_GAP_FRAMES+1)
                ora_blob = None

            has_hub    = hub_px_raw is not None
            has_orange = ora_blob is not None

            # Stable hub
            if has_hub:
                hub_buf.append(np.array(hub_px_raw))
                if len(hub_buf) > 30: hub_buf.pop(0)
                hub_stable = np.mean(hub_buf, axis=0)
                if has_orange:
                    d_ora = math.hypot(ora_blob[0]-hub_stable[0],
                                       ora_blob[1]-hub_stable[1])
                    hub_radius = max(hub_radius or 0, d_ora*1.3)

            # Geometry
            rot_raw  = None
            scale_mm = None
            if has_hub and has_orange:
                rot_raw = orange_angle(ora_blob, hub_px_raw)

            if rot_raw is not None and zero_offset is None:
                zero_offset = rot_raw

            rot_z = ((rot_raw-zero_offset)%360
                     if (rot_raw is not None and zero_offset is not None)
                     else None)

            if rot_z is not None:
                rot_buf.append(rot_z)
                if len(rot_buf) > SMOOTH_N: rot_buf.pop(0)
                rot_smooth = math.degrees(math.atan2(
                    np.mean([math.sin(math.radians(x)) for x in rot_buf]),
                    np.mean([math.cos(math.radians(x)) for x in rot_buf]),
                )) % 360
            else:
                rot_smooth = rot_buf[-1] if rot_buf else None

            if rot_smooth is not None:
                if rot_prev is not None:
                    rot_cum = unwrap(rot_prev, rot_smooth, rot_cum)
                rot_prev = rot_smooth

            if len(rot_buf) >= 2:
                d = rot_buf[-1]-rot_buf[-2]
                if d >  180: d -= 360
                if d < -180: d += 360
                vel_dps = d * fps_assumed

            conf = compute_confidence(has_hub, has_orange, hub_source or "")
            conf_smooth = conf_smooth*0.6 + conf*0.4
            conf_disp   = int(round(conf_smooth))

            hub_px = hub_px_raw  # для ответа

            if t_sec >= next_sample_at:
                s = make_sample(
                    job_id=job_id, timestamp_sec=t_sec,
                    rotation_deg=rot_smooth, cumulative_deg=-rot_cum,
                    angular_vel_dps=-vel_dps, confidence_pct=conf_disp,
                    source=hub_source,
                )
                all_samples.append(s)
                next_sample_at += sample_interval
                if len(all_samples) % 20 == 0:
                    persist_samples(job_id, all_samples[-20:])

            await ws.send_text(json.dumps({
                "frame":           frame_idx,
                "rotation_deg":    round(rot_smooth,2) if rot_smooth is not None else None,
                "rotation_rad":    round(math.radians(rot_smooth),5) if rot_smooth is not None else None,
                "cumulative_deg":  round(-rot_cum,2),
                "cumulative_rad":  round(math.radians(-rot_cum),5),
                "angular_vel_dps": round(-vel_dps,2),
                "angular_vel_rps": round(math.radians(-vel_dps),5),
                "confidence_pct":  conf_disp,
                "hub_px":          [round(hub_px[0]),round(hub_px[1])] if hub_px else None,
                "scale_mm_px":     round(scale_mm,5) if scale_mm else None,
                "source":          hub_source,
            }))
            frame_idx += 1

    except WebSocketDisconnect:
        log.info(f"[WS] disconnected after {frame_idx} frames")
    except Exception as exc:
        log.error(f"[WS] error: {exc}", exc_info=True)
        try: await ws.send_text(json.dumps({"error": str(exc)}))
        except Exception: pass
    finally:
        rem = len(all_samples) % 20
        if rem: persist_samples(job_id, all_samples[-rem:])
        finish_job(job_id, len(all_samples),
                   all_samples[-1]["timestamp_sec"] if all_samples else 0)


@app.get("/health")
def health():
    return {
        "status":          "ok",
        "jobs":            len(jobs),
        "samples_per_sec": SAMPLES_PER_SECOND,
        "supabase":        SUPABASE_URL[:35]+"...",
    }