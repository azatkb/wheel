"""
detector.py
===========
Core wheel rotation detection.

Detection priority:
  1. YOLO center  → hub (wheel center)
  2. YOLO orange  → rotation reference (color-verified)
  3. OpenCV orange → fallback if YOLO misses orange
  4. OpenCV yellow/red pair → hub fallback (DISABLED by USE_PAIR_FALLBACK)

Pipeline per frame:
  1. Stabilize (ECC warp)
  2. Bilateral filter (denoise, preserve color edges)
  3. YOLO detection (center + orange only)
  4. OpenCV HSV detection (orange fallback, pair fallback if enabled)
  5. Dynamic ROI mask (only search inside wheel disk)
  6. Orange angle from hub (raw, not smoothed line)
  7. Zero calibration — first orange angle = 0 deg
  8. Angle smoothing (circular mean)
  9. Cumulative rotation + angular velocity
 10. Sampling at SAMPLES_PER_SECOND rate
 11. Draw overlay: neon green tracking circle, info bar

Output: annotated video  +  list of sample dicts
"""

import cv2
import numpy as np
import math
import logging
from pathlib import Path

from app.config import (
    MAX_Y_FRAC, MIN_BLOB, MAX_BLOB, MIN_PAIR_DIST,
    MAX_GAP_FRAMES, ROI_FACTOR, SMOOTH_N,
    WHEEL_DIAMETER_MM, WHEEL_RADIUS_MM, BAR_HEIGHT,
    SAMPLES_PER_SECOND, OUTPUT_FPS,
    TRACK_CIRCLE_COLOR, TRACK_CIRCLE_THICK, TRACK_CIRCLE_GLOW,
    DEFAULT_INFO_LEVEL,
)
from app.stabilizer import Stabilizer
from app.database import make_sample, persist_samples

log = logging.getLogger(__name__)

# ── Feature flags ──────────────────────────────────────────────────────────
USE_YOLO          = True    # use YOLO if best.pt available
USE_PAIR_FALLBACK = False   # DISABLED: use yellow/red pair as hub fallback

# ── YOLO config ────────────────────────────────────────────────────────────
YOLO_WEIGHTS = "best.pt"
YOLO_CONF    = 0.35
YOLO_CLASSES = ["center", "orange"]

# Orange HSV verification (OpenCV scale: H 0-180, S 0-255)
ORANGE_H_LO = 8
ORANGE_H_HI = 22
ORANGE_S_MIN = 80

# ── OpenCV HSV ranges ──────────────────────────────────────────────────────
def _u(h, s, v):
    """H(0-360) S(0-100%) V(0-100%) → OpenCV HSV."""
    return round(h/2), round(s/100*255), round(v/100*255)

MARKER_DEFS = {
    "YELLOW": {
        "lo": (40, 22, 71), "hi": (64, 37, 94),
        "color_bgr": (0, 220, 220),
        "count": 2, "tol_h": 8, "tol_s": 8, "tol_v": 8, "select": "area",
    },
    "RED": {
        "lo": (344, 30, 14), "hi": (360, 56, 47),
        "color_bgr": (60, 60, 255),
        "count": 2, "tol_h": 8, "tol_s": 10, "tol_v": 10, "select": "area",
    },
    "ORANGE": {
        "lo": (10, 67, 78), "hi": (26, 84, 95),
        "color_bgr": (0, 180, 255),
        "count": 1, "tol_h": 0, "tol_s": 0, "tol_v": 0, "select": "sat",
    },
}

_kernel = np.ones((5, 5), np.uint8)


# ── YOLO ───────────────────────────────────────────────────────────────────

def load_yolo():
    if not USE_YOLO or not Path(YOLO_WEIGHTS).exists():
        log.warning(f"[YOLO] not loaded — OpenCV only mode")
        return None
    try:
        from ultralytics import YOLO
        model = YOLO(YOLO_WEIGHTS)
        log.info(f"[YOLO] loaded {YOLO_WEIGHTS}")
        return model
    except Exception as e:
        log.warning(f"[YOLO] load failed: {e}")
        return None


def detect_yolo(model, frame, hsv) -> dict:
    """
    Run YOLO inference for center + orange.
    Orange is color-verified against HSV before accepting.
    Returns dict: {center: blob|None, orange: blob|None}
    blob = (cx, cy, area, sat, r)
    """
    result = {"center": None, "orange": None}
    if model is None:
        return result

    try:
        detections = model(frame, conf=YOLO_CONF, verbose=False)[0]
        best = {}
        for box in detections.boxes:
            cls  = int(box.cls[0])
            conf = float(box.conf[0])
            if cls >= len(YOLO_CLASSES): continue
            name = YOLO_CLASSES[cls]
            x1,y1,x2,y2 = map(int, box.xyxy[0])
            # Clamp to frame bounds
            h_f, w_f = frame.shape[:2]
            x1=max(0,x1); y1=max(0,y1); x2=min(w_f,x2); y2=min(h_f,y2)
            if x2<=x1 or y2<=y1: continue
            cx = (x1+x2)//2; cy = (y1+y2)//2
            area = max(1,(x2-x1)*(y2-y1))
            r    = max(5, int(math.sqrt(area/math.pi)))

            if name == "orange":
                # Verify color in HSV — sample center pixel
                h_val = int(hsv[cy, cx, 0])
                s_val = int(hsv[cy, cx, 1])
                if not (ORANGE_H_LO <= h_val <= ORANGE_H_HI and s_val >= ORANGE_S_MIN):
                    # Sample patch average instead of single pixel
                    patch_h = hsv[max(0,cy-4):cy+4, max(0,cx-4):cx+4, 0]
                    patch_s = hsv[max(0,cy-4):cy+4, max(0,cx-4):cx+4, 1]
                    h_val = int(np.median(patch_h))
                    s_val = int(np.median(patch_s))
                    if not (ORANGE_H_LO <= h_val <= ORANGE_H_HI and s_val >= ORANGE_S_MIN):
                        log.debug(f"[YOLO] orange rejected: H={h_val} S={s_val}")
                        continue

            sat = int(hsv[cy, cx, 1])
            if name not in best or conf > best[name]["conf"]:
                best[name] = {"blob": (cx,cy,area,sat,r), "conf": conf}

        for name, d in best.items():
            result[name] = d["blob"]

    except Exception as e:
        log.warning(f"[YOLO] inference error: {e}")

    return result


# ── OpenCV detection ───────────────────────────────────────────────────────

def build_ranges(defs: dict) -> dict:
    result = {}
    for name, d in defs.items():
        lo_cv = _u(*d["lo"]); hi_cv = _u(*d["hi"])
        th = round(d.get("tol_h", 0) / 2)
        ts = round(d.get("tol_s", 0) / 100 * 255)
        tv = round(d.get("tol_v", 0) / 100 * 255)
        hl = max(0,   min(lo_cv[0], hi_cv[0]) - th)
        hh = min(180, max(lo_cv[0], hi_cv[0]) + th)
        sl = max(0,   min(lo_cv[1], hi_cv[1]) - ts)
        sh = min(255, max(lo_cv[1], hi_cv[1]) + ts)
        vl = max(0,   min(lo_cv[2], hi_cv[2]) - tv)
        vh = min(255, max(lo_cv[2], hi_cv[2]) + tv)
        lo1 = np.array([hl,sl,vl], dtype=np.uint8)
        hi1 = np.array([hh,sh,vh], dtype=np.uint8)
        lo2 = hi2 = None
        if hl == 0 and min(lo_cv[0],hi_cv[0]) - th < 0:
            lo2 = np.array([max(0,180+(min(lo_cv[0],hi_cv[0])-th)),sl,vl], dtype=np.uint8)
            hi2 = np.array([180,sh,vh], dtype=np.uint8)
        elif hh == 180 and max(lo_cv[0],hi_cv[0]) + th > 180:
            lo2 = np.array([0,sl,vl], dtype=np.uint8)
            hi2 = np.array([(max(lo_cv[0],hi_cv[0])+th)-180,sh,vh], dtype=np.uint8)
        result[name] = {
            "lo":lo1,"hi":hi1,"lo2":lo2,"hi2":hi2,
            "color_bgr":d["color_bgr"],
            "count":d["count"],"select":d.get("select","area"),
        }
        w = f" +wrap[{lo2[0]}-{hi2[0]}]" if lo2 is not None else ""
        log.info(f"  [{name:8s}] H:[{hl}-{hh}] S:[{sl}-{sh}] V:[{vl}-{vh}]{w}")
    return result


def find_blobs(hsv: np.ndarray, m: dict, max_y: int) -> list:
    mask = cv2.inRange(hsv, m["lo"], m["hi"])
    if m["lo2"] is not None:
        mask = cv2.bitwise_or(mask, cv2.inRange(hsv, m["lo2"], m["hi2"]))
    mask[max_y:,:]=0; mask[:15,:]=0; mask[:,:12]=0; mask[:,-12:]=0
    mask = cv2.morphologyEx(mask, cv2.MORPH_OPEN,  _kernel)
    mask = cv2.morphologyEx(mask, cv2.MORPH_CLOSE, _kernel)
    cnts,_ = cv2.findContours(mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    cands = []
    for c in cnts:
        area = cv2.contourArea(c)
        if area < MIN_BLOB or area > MAX_BLOB: continue
        M = cv2.moments(c)
        if M["m00"] == 0: continue
        cx  = int(M["m10"]/M["m00"]); cy = int(M["m01"]/M["m00"])
        sat = int(hsv[cy,cx,1])
        r   = max(5, int(math.sqrt(area/math.pi)))
        cands.append((cx,cy,area,sat,r))
    if m["select"]=="sat": cands.sort(key=lambda b:-b[3])
    else:                  cands.sort(key=lambda b:-b[2])
    return cands[:m["count"]]


def pick_farthest_pair(blobs: list):
    best = None; best_d = 0
    for i in range(len(blobs)):
        for j in range(i+1, len(blobs)):
            d = math.hypot(blobs[i][0]-blobs[j][0], blobs[i][1]-blobs[j][1])
            if d > best_d:
                best_d = d; best = (blobs[i], blobs[j])
    return best, best_d


# ── Geometry ───────────────────────────────────────────────────────────────

def wheel_hub(ya, yb):
    return ((ya[0]+yb[0])/2.0, (ya[1]+yb[1])/2.0)


def orange_angle(ora, hub) -> float:
    dx = ora[0]-hub[0]; dy = ora[1]-hub[1]
    return math.degrees(math.atan2(dx, -dy)) % 360


def unwrap(prev: float, curr: float, cum: float) -> float:
    d = curr - prev
    if d >  180: d -= 360
    if d < -180: d += 360
    return cum + d


def compute_confidence(has_hub: bool, has_orange: bool, hub_src: str) -> int:
    if has_hub and has_orange:
        return 100 if hub_src == "YOLO" else 85
    if has_hub:    return 60
    if has_orange: return 15
    return 0


# ── Drawing ────────────────────────────────────────────────────────────────

def draw_neon_circle(img, center, radius, color, thickness, glow):
    x,y = int(center[0]),int(center[1])
    if glow:
        gc = tuple(int(c*0.4) for c in color)
        cv2.circle(img,(x,y),radius+5,gc,thickness+2,cv2.LINE_AA)
        cv2.circle(img,(x,y),radius+2,gc,thickness,  cv2.LINE_AA)
    cv2.circle(img,(x,y),radius,color,thickness,cv2.LINE_AA)
    cv2.circle(img,(x,y),3,color,-1,cv2.LINE_AA)


def draw_info_bar(bar, W, t_sec, rot_deg, rot_rad, cum_deg, cum_rad,
                  vel_dps, vel_rps, conf, source, info_level, direction, medium):
    GREEN=(0,255,128); WHITE=(230,230,230); GRAY=(120,120,120); YELLOW=(0,220,220)
    def conf_col(p):
        if p>=80: return (40,200,40)
        if p>=50: return (0,200,220)
        return (40,40,220)
    cc=conf_col(conf); c1,c2,c3=14,W//3,2*W//3

    cv2.putText(bar,"TIME",(c1,22),cv2.FONT_HERSHEY_SIMPLEX,0.38,GRAY,1)
    cv2.putText(bar,f"{t_sec:.2f} s",(c1,50),cv2.FONT_HERSHEY_SIMPLEX,0.85,WHITE,2,cv2.LINE_AA)
    cv2.putText(bar,"ROTATION",(c1,78),cv2.FONT_HERSHEY_SIMPLEX,0.38,GRAY,1)
    rot_txt=f"{rot_deg:.1f}" if rot_deg is not None else "---"
    cv2.putText(bar,rot_txt,(c1,108),cv2.FONT_HERSHEY_SIMPLEX,0.95,YELLOW,2,cv2.LINE_AA)
    cv2.putText(bar,"deg",(c1+90,108),cv2.FONT_HERSHEY_SIMPLEX,0.50,YELLOW,1)
    if info_level=="full" and rot_rad is not None:
        cv2.putText(bar,f"{rot_rad:.4f} rad",(c1,128),cv2.FONT_HERSHEY_SIMPLEX,0.40,GRAY,1)
    cv2.putText(bar,"TOTAL",(c1,150),cv2.FONT_HERSHEY_SIMPLEX,0.38,GRAY,1)
    cv2.putText(bar,f"{cum_deg:+.1f}",(c1,192),cv2.FONT_HERSHEY_SIMPLEX,1.25,GREEN,3,cv2.LINE_AA)
    cv2.putText(bar,"deg",(c1+130,192),cv2.FONT_HERSHEY_SIMPLEX,0.55,GREEN,2)
    if info_level=="full":
        cv2.putText(bar,f"{cum_rad:+.4f} rad",(c1,210),cv2.FONT_HERSHEY_SIMPLEX,0.38,GRAY,1)
    if info_level=="full" and vel_dps is not None:
        cv2.putText(bar,f"vel: {vel_dps:+.1f} deg/s  {vel_rps:+.4f} rad/s",
                    (c1,228),cv2.FONT_HERSHEY_SIMPLEX,0.38,GRAY,1)
        cv2.putText(bar,f"dir: {direction}  medium: {medium}",
                    (c1,248),cv2.FONT_HERSHEY_SIMPLEX,0.36,GRAY,1)

    cv2.putText(bar,"SIGNIFICANCE",(c2,22),cv2.FONT_HERSHEY_SIMPLEX,0.38,GRAY,1)
    cv2.putText(bar,f"{conf}%",(c2,68),cv2.FONT_HERSHEY_SIMPLEX,1.15,cc,2,cv2.LINE_AA)
    bw=c3-c2-20
    cv2.rectangle(bar,(c2,76),(c2+bw,92),(40,40,40),-1)
    fw=int(bw*conf/100)
    if fw>0: cv2.rectangle(bar,(c2,76),(c2+fw,92),cc,-1)
    cv2.rectangle(bar,(c2,76),(c2+bw,92),(70,70,70),1)

    def dot(ok,x,y): cv2.circle(bar,(x,y),5,(40,200,40) if ok else (60,60,60),-1)
    dot(source is not None,c2+8,118)
    cv2.putText(bar,"Hub found" if source else "No hub",
                (c2+22,123),cv2.FONT_HERSHEY_SIMPLEX,0.40,WHITE if source else GRAY,1)
    dot(conf>=85,c2+8,146)
    cv2.putText(bar,"Orange found" if conf>=85 else "Orange missing",
                (c2+22,151),cv2.FONT_HERSHEY_SIMPLEX,0.40,
                WHITE if conf>=85 else GRAY,1)
    if source:
        cv2.putText(bar,f"hub: {source}",(c2,172),cv2.FONT_HERSHEY_SIMPLEX,0.40,(40,200,40),1)

    dcx=c3+(W-c3)//2; dcy=100; dr=68
    cv2.circle(bar,(dcx,dcy),dr,(45,45,45),-1)
    cv2.circle(bar,(dcx,dcy),dr,(80,80,80),1)
    cv2.line(bar,(dcx,dcy-dr),(dcx,dcy-dr+8),(90,90,90),1)
    if rot_deg is not None:
        rad=math.radians(rot_deg)
        nx=int(dcx+(dr-10)*math.sin(rad)); ny=int(dcy-(dr-10)*math.cos(rad))
        cv2.line(bar,(dcx,dcy),(nx,ny),cc,2,cv2.LINE_AA)
    cv2.circle(bar,(dcx,dcy),4,cc,-1)
    ang_txt=f"{rot_deg:.1f} deg" if rot_deg is not None else "---"
    cv2.putText(bar,ang_txt,(dcx-32,dcy+dr+18),cv2.FONT_HERSHEY_SIMPLEX,0.46,cc,1,cv2.LINE_AA)
    cv2.putText(bar,"current angle",(dcx-40,dcy+dr+34),cv2.FONT_HERSHEY_SIMPLEX,0.32,GRAY,1)


# ── Main processing function ───────────────────────────────────────────────

def process(video_path: str, out_path: str, job_id: str = "local",
            direction: str = "auto", medium: str = "air",
            info_level: str = "basic") -> list:

    log.info("[DETECT] Building HSV ranges:")
    markers = build_ranges(MARKER_DEFS)

    log.info("[DETECT] Loading YOLO:")
    yolo = load_yolo()
    yolo_active = yolo is not None
    log.info(f"[DETECT] Mode: {'YOLO+OpenCV' if yolo_active else 'OpenCV only'}  "
             f"pair_fallback={'ON' if USE_PAIR_FALLBACK else 'OFF'}")

    cap = cv2.VideoCapture(video_path)
    if not cap.isOpened():
        raise RuntimeError(f"Cannot open video: {video_path}")

    fps   = cap.get(cv2.CAP_PROP_FPS) or 30.0
    W     = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
    H     = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
    total = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))

    rot_meta    = int(cap.get(97))
    auto_rotate = None
    if rot_meta == 90:    auto_rotate = cv2.ROTATE_90_CLOCKWISE
    elif rot_meta == 270: auto_rotate = cv2.ROTATE_90_COUNTERCLOCKWISE
    elif rot_meta == 180: auto_rotate = cv2.ROTATE_180
    if auto_rotate in (cv2.ROTATE_90_CLOCKWISE, cv2.ROTATE_90_COUNTERCLOCKWISE):
        W, H = H, W
        log.info(f"[DETECT] Auto-rotate {rot_meta}deg → {W}x{H}")

    max_y  = int(H * MAX_Y_FRAC)
    log.info(f"[DETECT] {W}x{H} @ {fps:.0f}fps  {total} frames ({total/fps:.1f}s)")

    fourcc  = cv2.VideoWriter_fourcc(*"mp4v")
    out_vid = cv2.VideoWriter(out_path, fourcc, fps, (W, H+BAR_HEIGHT))

    stab = Stabilizer()

    rot_prev     = None
    rot_cum      = 0.0
    rot_buf      = []
    zero_offset  = None
    vel_dps      = 0.0
    vel_rps      = 0.0

    hub_buf      = []
    hub_stable   = None
    hub_radius   = None
    hub_source   = None

    gap_hub      = 0
    gap_ora      = 0
    last_hub     = None
    last_ora     = None

    # Pair fallback state (disabled, kept for future use)
    active_color = None
    last_ya      = None
    last_yb      = None

    conf_smooth  = 0.0

    sample_interval = 1.0 / SAMPLES_PER_SECOND
    next_sample_at  = 0.0
    all_samples     = []
    FLUSH_EVERY     = 20

    fi = 0
    while True:
        ret, frame = cap.read()
        if not ret: break

        if auto_rotate is not None:
            frame = cv2.rotate(frame, auto_rotate)

        t_sec = fi / fps

        frame_stab = stab.stabilize(frame)
        preproc    = cv2.bilateralFilter(frame_stab, 7, 50, 50)
        hsv        = cv2.cvtColor(preproc, cv2.COLOR_BGR2HSV)

        # Dynamic ROI
        if hub_stable is not None and hub_radius is not None:
            roi_mask = np.zeros(hsv.shape[:2], np.uint8)
            cv2.circle(roi_mask,
                       (int(hub_stable[0]),int(hub_stable[1])),
                       int(hub_radius*1.15), 255, -1)
            hsv_src = cv2.bitwise_and(hsv, hsv, mask=roi_mask)
        else:
            hsv_src = hsv

        # ── YOLO: center + orange (color-verified) ─────────────────────────
        yolo_det = detect_yolo(yolo, preproc, hsv)

        # ── OpenCV orange fallback ─────────────────────────────────────────
        cv_ora = find_blobs(hsv_src, markers["ORANGE"], max_y)

        # ── Pair fallback (DISABLED) ───────────────────────────────────────
        if USE_PAIR_FALLBACK:
            cv_yel = find_blobs(hsv_src, markers["YELLOW"], max_y)
            cv_red = find_blobs(hsv_src, markers["RED"],    max_y)
        else:
            cv_yel = []; cv_red = []

        # ── Hub source ─────────────────────────────────────────────────────
        hub_px_raw = None

        if yolo_det["center"] is not None:
            cx,cy,_,_,_ = yolo_det["center"]
            hub_px_raw  = (float(cx), float(cy))
            hub_source  = "YOLO"
            gap_hub     = 0
            last_hub    = hub_px_raw

        elif USE_PAIR_FALLBACK:
            yel_pair, yel_dist = pick_farthest_pair(cv_yel)
            red_pair, red_dist = pick_farthest_pair(cv_red)
            use_yellow = yel_pair is not None and yel_dist > MIN_PAIR_DIST
            use_red    = (not use_yellow) and red_pair is not None and red_dist > MIN_PAIR_DIST
            if use_yellow:
                active_pair, active_color = yel_pair, "YELLOW"
            elif use_red:
                active_pair, active_color = red_pair, "RED"
            else:
                active_pair = None
            if active_pair is not None:
                b0,b1 = active_pair
                hub_px_raw = wheel_hub(b0, b1)
                hub_source = active_color
                gap_hub    = 0; last_hub = hub_px_raw
                last_ya = b0 if b0[1]<=b1[1] else b1
                last_yb = b1 if b0[1]<=b1[1] else b0
            elif gap_hub < MAX_GAP_FRAMES and last_hub:
                gap_hub += 1; hub_px_raw = last_hub
        elif gap_hub < MAX_GAP_FRAMES and last_hub:
            gap_hub   += 1
            hub_px_raw = last_hub

        # ── Orange source ──────────────────────────────────────────────────
        # Priority: YOLO orange (color-verified) >> OpenCV >> gap fill
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

        # ── Stable hub ─────────────────────────────────────────────────────
        if has_hub:
            hub_buf.append(np.array(hub_px_raw))
            if len(hub_buf) > 30: hub_buf.pop(0)
            hub_stable = np.mean(hub_buf, axis=0)
            if yolo_det["center"] is not None:
                _,_,_,_,r = yolo_det["center"]
                hub_radius = max(hub_radius or 0, r*ROI_FACTOR*3)
            if has_orange and hub_stable is not None:
                d_ora = math.hypot(ora_blob[0]-hub_stable[0],
                                   ora_blob[1]-hub_stable[1])
                hub_radius = max(hub_radius or 0, d_ora*1.3)

        # ── Rotation angle (raw from current frame, not smoothed pos) ──────
        rot_raw = None
        if has_hub and has_orange:
            # Use raw hub_px_raw (current frame), not smoothed hub_stable
            # This ensures the line reflects actual current position
            rot_raw = orange_angle(ora_blob, hub_px_raw)

        if rot_raw is not None and zero_offset is None:
            zero_offset = rot_raw
            log.info(f"[DETECT] Zero offset t={t_sec:.2f}s: {zero_offset:.1f}deg  hub={hub_source}")

        rot_zeroed = ((rot_raw-zero_offset)%360
                      if (rot_raw is not None and zero_offset is not None)
                      else None)

        if rot_zeroed is not None:
            rot_buf.append(rot_zeroed)
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

        if len(rot_buf) >= 2 and fps > 0:
            d_angle = rot_buf[-1]-rot_buf[-2]
            if d_angle >  180: d_angle -= 360
            if d_angle < -180: d_angle += 360
            vel_dps = d_angle * fps
            vel_rps = math.radians(vel_dps)

        conf    = compute_confidence(has_hub, has_orange, hub_source or "")
        conf_smooth = conf_smooth*0.6 + conf*0.4
        conf_disp   = int(round(conf_smooth))

        if t_sec >= next_sample_at:
            sample = make_sample(
                job_id          = job_id,
                timestamp_sec   = t_sec,
                rotation_deg    = rot_smooth,
                cumulative_deg  = -rot_cum,
                angular_vel_dps = -vel_dps,
                confidence_pct  = conf_disp,
                source          = hub_source,
            )
            all_samples.append(sample)
            next_sample_at += sample_interval
            if len(all_samples) % FLUSH_EVERY == 0:
                persist_samples(job_id, all_samples[-FLUSH_EVERY:])
                log.debug(f"[DETECT] Flushed {FLUSH_EVERY} samples t={t_sec:.1f}s")

        # ── Draw ──────────────────────────────────────────────────────────
        ann = frame_stab.copy()

        # YOLO detections
        if yolo_det["center"] is not None:
            cx,cy,_,_,r = yolo_det["center"]
            cv2.circle(ann,(cx,cy),r+4,(255,255,255),2,cv2.LINE_AA)
            cv2.putText(ann,"Y:center",(cx+r+4,cy+5),
                        cv2.FONT_HERSHEY_SIMPLEX,0.45,(255,255,255),1,cv2.LINE_AA)
        if yolo_det["orange"] is not None:
            cx,cy,_,_,r = yolo_det["orange"]
            cv2.circle(ann,(cx,cy),r+4,(0,140,255),2,cv2.LINE_AA)
            cv2.putText(ann,"Y:orange",(cx+r+4,cy+5),
                        cv2.FONT_HERSHEY_SIMPLEX,0.45,(0,140,255),1,cv2.LINE_AA)

        # Stable hub dot
        if hub_stable is not None:
            hcol = (40,200,40) if hub_source=="YOLO" else (200,200,40)
            cv2.circle(ann,(int(hub_stable[0]),int(hub_stable[1])),7,hcol,-1,cv2.LINE_AA)
            cv2.circle(ann,(int(hub_stable[0]),int(hub_stable[1])),9,(0,0,0),1,cv2.LINE_AA)

        # Orange neon circle
        if has_orange and ora_blob:
            draw_neon_circle(ann,(ora_blob[0],ora_blob[1]),ora_blob[4]+6,
                             TRACK_CIRCLE_COLOR,TRACK_CIRCLE_THICK,TRACK_CIRCLE_GLOW)
            cv2.putText(ann,"ORA",(ora_blob[0]+ora_blob[4]+8,ora_blob[1]+5),
                        cv2.FONT_HERSHEY_SIMPLEX,0.45,TRACK_CIRCLE_COLOR,1,cv2.LINE_AA)

        # Line from raw hub to orange (not smoothed — shows real current position)
        if has_hub and has_orange and hub_px_raw:
            cv2.line(ann,
                     (int(hub_px_raw[0]), int(hub_px_raw[1])),
                     (ora_blob[0], ora_blob[1]),
                     TRACK_CIRCLE_COLOR, 1, cv2.LINE_AA)

        # Mode tag
        mode_txt = "YOLO+CV" if yolo_active else "CV only"
        cv2.putText(ann,mode_txt,(W-110,24),cv2.FONT_HERSHEY_SIMPLEX,0.55,
                    (40,200,40) if yolo_active else (100,100,100),1)

        bar = np.full((BAR_HEIGHT,W,3),(18,18,18),dtype=np.uint8)
        cv2.line(bar,(0,0),(W,0),(55,55,55),1)

        draw_info_bar(
            bar=bar, W=W, t_sec=t_sec,
            rot_deg    = rot_smooth,
            rot_rad    = math.radians(rot_smooth) if rot_smooth is not None else None,
            cum_deg    = -rot_cum,
            cum_rad    = math.radians(-rot_cum),
            vel_dps    = -vel_dps, vel_rps=-vel_rps,
            conf       = conf_disp, source=hub_source,
            info_level = info_level, direction=direction, medium=medium,
        )

        out_vid.write(np.vstack([ann, bar]))

        if fi % 60 == 0:
            rot_str = f"{rot_smooth:.1f}" if rot_smooth is not None else "---"
            log.info(f"  [{fi:4d}/{total}]  t={t_sec:.1f}s  "
                     f"rot={rot_str}  cum={-rot_cum:.1f}  "
                     f"conf={conf_disp}%  hub={hub_source}")
        fi += 1

    remainder = len(all_samples) % FLUSH_EVERY
    if remainder > 0:
        persist_samples(job_id, all_samples[-remainder:])

    cap.release()
    out_vid.release()
    log.info(f"[DETECT] Done. {len(all_samples)} samples  →  {out_path}")
    return all_samples