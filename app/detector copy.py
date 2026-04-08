"""
detector.py
===========
Core wheel rotation detection.

Pipeline per frame:
  1. Stabilize (ECC warp)
  2. Bilateral filter (denoise, preserve color edges)
  3. Dynamic ROI mask (only search inside wheel disk)
  4. HSV blob detection  — YELLOW (x2) primary, RED (x2) fallback
  5. Orange blob detection — rotation reference (0 deg)
  6. Zero calibration — first orange angle = 0 deg
  7. Angle smoothing (circular mean)
  8. Cumulative rotation + angular velocity
  9. Sampling at SAMPLES_PER_SECOND rate
 10. Draw overlay: neon green tracking circle, info bar

Output: annotated video  +  list of sample dicts
"""

import cv2
import numpy as np
import math
import logging

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

# ── HSV color ranges ───────────────────────────────────────────────────────
# All values in OpenCV format: H 0-180, S 0-255, V 0-255

def _u(h, s, v):
    """Convert human-readable H(0-360) S(0-100%) V(0-100%) to OpenCV HSV."""
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


def build_ranges(defs: dict) -> dict:
    """
    Convert human-readable HSV ranges + tolerances to OpenCV arrays.
    Handles hue wrap-around for red (crosses 0/360).
    """
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
        lo1 = np.array([hl, sl, vl]); hi1 = np.array([hh, sh, vh])
        lo2 = hi2 = None
        # Hue wrap-around for red (near 0° and 360°)
        if hl == 0 and min(lo_cv[0], hi_cv[0]) - th < 0:
            lo2 = np.array([max(0, 180+(min(lo_cv[0],hi_cv[0])-th)), sl, vl])
            hi2 = np.array([180, sh, vh])
        elif hh == 180 and max(lo_cv[0], hi_cv[0]) + th > 180:
            lo2 = np.array([0, sl, vl])
            hi2 = np.array([(max(lo_cv[0],hi_cv[0])+th)-180, sh, vh])
        result[name] = {
            "lo": lo1, "hi": hi1, "lo2": lo2, "hi2": hi2,
            "color_bgr": d["color_bgr"],
            "count": d["count"], "select": d.get("select","area"),
        }
        w = f" +wrap[{lo2[0]}-{hi2[0]}]" if lo2 is not None else ""
        log.info(f"  [{name:8s}] H:[{hl}-{hh}] S:[{sl}-{sh}] V:[{vl}-{vh}]{w}")
    return result


def find_blobs(hsv: np.ndarray, m: dict, max_y: int) -> list:
    """
    Find colored blobs in an HSV image.
    Returns list of (cx, cy, area, sat, radius) tuples sorted by area or sat.
    """
    mask = cv2.inRange(hsv, m["lo"], m["hi"])
    # Add wrap-around mask for red
    if m["lo2"] is not None:
        mask = cv2.bitwise_or(mask, cv2.inRange(hsv, m["lo2"], m["hi2"]))
    # Remove bottom of frame, borders
    mask[max_y:, :] = 0
    mask[:15, :]    = 0
    mask[:, :12]    = 0
    mask[:, -12:]   = 0
    # Morphological clean-up: remove noise, fill gaps
    mask = cv2.morphologyEx(mask, cv2.MORPH_OPEN,  _kernel)
    mask = cv2.morphologyEx(mask, cv2.MORPH_CLOSE, _kernel)

    cnts, _ = cv2.findContours(mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    cands = []
    for c in cnts:
        area = cv2.contourArea(c)
        if area < MIN_BLOB or area > MAX_BLOB:
            continue
        M = cv2.moments(c)
        if M["m00"] == 0:
            continue
        cx  = int(M["m10"] / M["m00"])
        cy  = int(M["m01"] / M["m00"])
        sat = int(hsv[cy, cx, 1])
        r   = max(5, int(math.sqrt(area / math.pi)))
        cands.append((cx, cy, area, sat, r))

    # Sort by saturation (for orange) or area (for yellow/red)
    if m["select"] == "sat":
        cands.sort(key=lambda b: -b[3])
    else:
        cands.sort(key=lambda b: -b[2])

    return cands[:m["count"]]


def pick_farthest_pair(blobs: list):
    """
    From a list of blobs pick the 2 that are farthest apart.
    This avoids accidentally picking two sub-blobs of the same sticker.
    Returns (pair, distance) or (None, 0).
    """
    best = None; best_d = 0
    for i in range(len(blobs)):
        for j in range(i+1, len(blobs)):
            d = math.hypot(blobs[i][0]-blobs[j][0], blobs[i][1]-blobs[j][1])
            if d > best_d:
                best_d = d; best = (blobs[i], blobs[j])
    return best, best_d


def wheel_hub(ya: tuple, yb: tuple):
    """Hub = midpoint of the opposite yellow (or red) pair."""
    return ((ya[0]+yb[0])/2.0, (ya[1]+yb[1])/2.0)


def orange_angle(ora: tuple, hub: tuple) -> float:
    """
    Clockwise angle of orange from 12-o'clock (top), measured from hub.
    Returns degrees in [0, 360).
    """
    dx = ora[0] - hub[0]
    dy = ora[1] - hub[1]
    return math.degrees(math.atan2(dx, -dy)) % 360


def unwrap(prev: float, curr: float, cum: float) -> float:
    """
    Unwrap angle jump to prevent 359→0 from being counted as -359 deg.
    Adds the shortest-path delta to the cumulative total.
    """
    d = curr - prev
    if d >  180: d -= 360
    if d < -180: d += 360
    return cum + d


def compute_confidence(n_pair: int, has_orange: bool) -> int:
    """
    Significance / confidence level (0-100%).
      100% = 2 opposite markers + orange  (full geometry known)
       70% = 2 opposite markers only      (rotation axis known)
       30% = 1 marker + orange
        0% = nothing detected
    """
    if n_pair >= 2 and has_orange: return 100
    if n_pair >= 2:                return 70
    if n_pair == 1 and has_orange: return 30
    if has_orange:                 return 15
    return 0


# ── Drawing helpers ────────────────────────────────────────────────────────

def draw_neon_circle(img: np.ndarray, center: tuple, radius: int,
                     color: tuple, thickness: int, glow: bool) -> None:
    """
    Draw a neon-style circle:
      - Outer dim glow ring (if glow=True)
      - Bright main circle
    """
    x, y = int(center[0]), int(center[1])
    if glow:
        # Slightly larger dim ring for glow effect
        glow_col = tuple(int(c * 0.4) for c in color)
        cv2.circle(img, (x, y), radius + 5, glow_col, thickness + 2, cv2.LINE_AA)
        cv2.circle(img, (x, y), radius + 2, glow_col, thickness,     cv2.LINE_AA)
    # Main bright circle
    cv2.circle(img, (x, y), radius, color, thickness, cv2.LINE_AA)
    # Small center dot
    cv2.circle(img, (x, y), 3, color, -1, cv2.LINE_AA)


def draw_info_bar(bar: np.ndarray, W: int,
                  t_sec: float, rot_deg: float, rot_rad: float,
                  cum_deg: float, cum_rad: float,
                  vel_dps: float, vel_rps: float,
                  conf: int, source: str,
                  info_level: str, direction: str, medium: str) -> None:
    """
    Draw the information bar below the video frame.
    info_level='basic' : time + degrees + confidence only
    info_level='full'  : all fields including radians, velocity, source
    """
    # Colors
    GREEN  = (0, 255, 128)
    WHITE  = (230, 230, 230)
    GRAY   = (120, 120, 120)
    YELLOW = (0, 220, 220)

    def conf_col(p):
        if p >= 80: return (40, 200, 40)
        if p >= 50: return (0, 200, 220)
        return (40, 40, 220)

    cc = conf_col(conf)

    # Column positions
    c1, c2, c3 = 14, W//3, 2*W//3

    # ── Column 1: time + rotation ──────────────────────────────────────────
    cv2.putText(bar, "TIME", (c1, 22), cv2.FONT_HERSHEY_SIMPLEX, 0.38, GRAY, 1)
    cv2.putText(bar, f"{t_sec:.2f} s", (c1, 50),
                cv2.FONT_HERSHEY_SIMPLEX, 0.85, WHITE, 2, cv2.LINE_AA)

    cv2.putText(bar, "ROTATION", (c1, 78), cv2.FONT_HERSHEY_SIMPLEX, 0.38, GRAY, 1)
    rot_txt = f"{rot_deg:.1f}" if rot_deg is not None else "---"
    cv2.putText(bar, rot_txt, (c1, 108),
                cv2.FONT_HERSHEY_SIMPLEX, 0.95, YELLOW, 2, cv2.LINE_AA)
    cv2.putText(bar, "deg", (c1+90, 108), cv2.FONT_HERSHEY_SIMPLEX, 0.50, YELLOW, 1)

    if info_level == "full" and rot_rad is not None:
        cv2.putText(bar, f"{rot_rad:.4f} rad", (c1, 128),
                    cv2.FONT_HERSHEY_SIMPLEX, 0.40, GRAY, 1)

    # Total rotation (big, bright green)
    cv2.putText(bar, "TOTAL", (c1, 150), cv2.FONT_HERSHEY_SIMPLEX, 0.38, GRAY, 1)
    cv2.putText(bar, f"{cum_deg:+.1f}", (c1, 192),
                cv2.FONT_HERSHEY_SIMPLEX, 1.25, GREEN, 3, cv2.LINE_AA)
    cv2.putText(bar, "deg", (c1+130, 192),
                cv2.FONT_HERSHEY_SIMPLEX, 0.55, GREEN, 2)

    if info_level == "full":
        cv2.putText(bar, f"{cum_rad:+.4f} rad", (c1, 210),
                    cv2.FONT_HERSHEY_SIMPLEX, 0.38, GRAY, 1)

    # Velocity
    if info_level == "full" and vel_dps is not None:
        cv2.putText(bar, f"vel: {vel_dps:+.1f} deg/s  {vel_rps:+.4f} rad/s",
                    (c1, 228), cv2.FONT_HERSHEY_SIMPLEX, 0.38, GRAY, 1)
        cv2.putText(bar, f"dir: {direction}  medium: {medium}",
                    (c1, 248), cv2.FONT_HERSHEY_SIMPLEX, 0.36, GRAY, 1)

    # ── Column 2: confidence ───────────────────────────────────────────────
    cv2.putText(bar, "SIGNIFICANCE", (c2, 22),
                cv2.FONT_HERSHEY_SIMPLEX, 0.38, GRAY, 1)
    cv2.putText(bar, f"{conf}%", (c2, 68),
                cv2.FONT_HERSHEY_SIMPLEX, 1.15, cc, 2, cv2.LINE_AA)

    # Confidence bar
    bw = c3 - c2 - 20
    cv2.rectangle(bar, (c2, 76), (c2+bw, 92), (40, 40, 40), -1)
    fw = int(bw * conf / 100)
    if fw > 0:
        cv2.rectangle(bar, (c2, 76), (c2+fw, 92), cc, -1)
    cv2.rectangle(bar, (c2, 76), (c2+bw, 92), (70, 70, 70), 1)

    # Dot indicators
    def dot(ok, x, y):
        cv2.circle(bar, (x, y), 5, (40,200,40) if ok else (60,60,60), -1)

    dot(source is not None, c2+8,  118)
    cv2.putText(bar, "Pair detected" if source else "No pair",
                (c2+22, 123), cv2.FONT_HERSHEY_SIMPLEX, 0.40,
                WHITE if source else GRAY, 1)

    dot(conf == 100, c2+8, 146)
    cv2.putText(bar, "Orange found" if conf == 100 else "Orange missing",
                (c2+22, 151), cv2.FONT_HERSHEY_SIMPLEX, 0.40,
                WHITE if conf == 100 else GRAY, 1)

    if source:
        src_col = YELLOW if source == "YELLOW" else (60, 60, 255)
        cv2.putText(bar, f"via {source}", (c2, 172),
                    cv2.FONT_HERSHEY_SIMPLEX, 0.40, src_col, 1)

    # ── Column 3: dial ─────────────────────────────────────────────────────
    dcx = c3 + (W - c3)//2
    dcy = 100
    dr  = 68
    cv2.circle(bar, (dcx, dcy), dr, (45, 45, 45), -1)
    cv2.circle(bar, (dcx, dcy), dr, (80, 80, 80), 1)
    # 12-o'clock tick
    cv2.line(bar, (dcx, dcy-dr), (dcx, dcy-dr+8), (90, 90, 90), 1)
    # Needle
    if rot_deg is not None:
        rad = math.radians(rot_deg)
        nx  = int(dcx + (dr-10) * math.sin(rad))
        ny  = int(dcy - (dr-10) * math.cos(rad))
        cv2.line(bar, (dcx, dcy), (nx, ny), cc, 2, cv2.LINE_AA)
    cv2.circle(bar, (dcx, dcy), 4, cc, -1)
    ang_txt = f"{rot_deg:.1f} deg" if rot_deg is not None else "---"
    cv2.putText(bar, ang_txt, (dcx-32, dcy+dr+18),
                cv2.FONT_HERSHEY_SIMPLEX, 0.46, cc, 1, cv2.LINE_AA)
    cv2.putText(bar, "current angle", (dcx-40, dcy+dr+34),
                cv2.FONT_HERSHEY_SIMPLEX, 0.32, GRAY, 1)


# ── Main processing function ───────────────────────────────────────────────

def process(video_path: str, out_path: str, job_id: str = "local",
            direction: str = "auto", medium: str = "air",
            info_level: str = "basic") -> list:
    """
    Process a video file end-to-end.
    Returns list of sample dicts (also written to DB+CSV).
    """
    log.info("[DETECT] Building HSV ranges:")
    markers = build_ranges(MARKER_DEFS)

    # Open source video
    cap = cv2.VideoCapture(video_path)
    if not cap.isOpened():
        raise RuntimeError(f"Cannot open video: {video_path}")

    fps   = cap.get(cv2.CAP_PROP_FPS) or 30.0
    W     = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
    H     = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
    total = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))

    # Fix phone rotation
    rot_meta    = int(cap.get(97))
    auto_rotate = None
    if rot_meta == 90:    auto_rotate = cv2.ROTATE_90_CLOCKWISE
    elif rot_meta == 270: auto_rotate = cv2.ROTATE_90_COUNTERCLOCKWISE
    elif rot_meta == 180: auto_rotate = cv2.ROTATE_180
    if auto_rotate in (cv2.ROTATE_90_CLOCKWISE, cv2.ROTATE_90_COUNTERCLOCKWISE):
        W, H = H, W
        log.info(f"[DETECT] Auto-rotate {rot_meta} deg → output {W}x{H}")

    max_y  = int(H * MAX_Y_FRAC)
    log.info(f"[DETECT] {W}x{H} @ {fps:.0f}fps  {total} frames ({total/fps:.1f}s)")

    fourcc  = cv2.VideoWriter_fourcc(*"mp4v")
    out_vid = cv2.VideoWriter(out_path, fourcc, fps, (W, H+BAR_HEIGHT))

    # ── Stabilizer ─────────────────────────────────────────────────────────
    stab = Stabilizer()

    # ── Tracking state ─────────────────────────────────────────────────────
    rot_prev    = None      # previous smoothed angle (for unwrap)
    rot_cum     = 0.0       # cumulative rotation (unwrapped)
    rot_buf     = []        # recent angles for circular-mean smoothing
    zero_offset = None      # first orange angle → 0 deg calibration
    vel_dps     = 0.0       # angular velocity degrees/second
    vel_rps     = 0.0       # angular velocity radians/second

    # Hub tracking (stable wheel center for ROI)
    hub_buf    = []
    hub_stable = None
    hub_radius = None

    # Temporal gap filling
    gap_yel    = 0
    gap_ora    = 0
    last_ya    = None
    last_yb    = None
    last_ora   = None
    MAX_GAP    = MAX_GAP_FRAMES

    # Active pair tracking (yellow primary, red fallback)
    active_color = None

    # Confidence smoothing
    conf_smooth = 0.0

    # Sampling
    sample_interval = 1.0 / SAMPLES_PER_SECOND
    next_sample_at  = 0.0
    all_samples     = []
    FLUSH_EVERY     = 20    # write to DB every N samples

    fi = 0
    while True:
        ret, frame = cap.read()
        if not ret:
            break

        # Fix phone rotation
        if auto_rotate is not None:
            frame = cv2.rotate(frame, auto_rotate)

        t_sec = fi / fps

        # ── Stabilize frame ────────────────────────────────────────────────
        frame_stab = stab.stabilize(frame)

        # ── Preprocess for detection ───────────────────────────────────────
        # Bilateral filter: removes sensor noise while keeping color edges sharp
        preproc = cv2.bilateralFilter(frame_stab, 7, 50, 50)
        hsv     = cv2.cvtColor(preproc, cv2.COLOR_BGR2HSV)

        # ── Dynamic ROI: only search inside the wheel disk ─────────────────
        if hub_stable is not None and hub_radius is not None:
            roi_mask = np.zeros(hsv.shape[:2], np.uint8)
            cv2.circle(roi_mask,
                       (int(hub_stable[0]), int(hub_stable[1])),
                       int(hub_radius * 1.15), 255, -1)
            hsv_src = cv2.bitwise_and(hsv, hsv, mask=roi_mask)
        else:
            hsv_src = hsv   # no ROI yet during warm-up

        # ── Detect markers ─────────────────────────────────────────────────
        yel_blobs = find_blobs(hsv_src, markers["YELLOW"], max_y)
        red_blobs = find_blobs(hsv_src, markers["RED"],    max_y)
        ora_blobs = find_blobs(hsv_src, markers["ORANGE"], max_y)

        # ── Pick pair: yellow preferred, red fallback ──────────────────────
        yel_pair, yel_dist = pick_farthest_pair(yel_blobs)
        red_pair, red_dist = pick_farthest_pair(red_blobs)

        use_yellow = yel_pair is not None and yel_dist > MIN_PAIR_DIST
        use_red    = (not use_yellow) and red_pair is not None and red_dist > MIN_PAIR_DIST

        if use_yellow:
            active_pair, active_dist, active_color = yel_pair, yel_dist, "YELLOW"
        elif use_red:
            active_pair, active_dist, active_color = red_pair, red_dist, "RED"
        else:
            active_pair, active_dist = None, 0

        has_pair   = active_pair is not None
        has_orange = len(ora_blobs) > 0

        # ── Temporal gap filling ───────────────────────────────────────────
        # If pair disappears briefly, keep last known position
        if has_pair:
            gap_yel = 0
            b0, b1  = active_pair
            last_ya = b0 if b0[1] <= b1[1] else b1    # higher = YEL_A
            last_yb = b1 if b0[1] <= b1[1] else b0
        elif gap_yel < MAX_GAP and last_ya and last_yb:
            gap_yel    += 1
            active_pair = (last_ya, last_yb)
            active_dist = math.hypot(last_ya[0]-last_yb[0], last_ya[1]-last_yb[1])
            has_pair    = active_dist > MIN_PAIR_DIST

        if has_orange:
            gap_ora = 0
            last_ora = ora_blobs[0]
        elif gap_ora < MAX_GAP and last_ora:
            gap_ora   += 1
            ora_blobs  = [last_ora]
            has_orange = True
        else:
            gap_ora = min(gap_ora+1, MAX_GAP+1)

        # ── Compute geometry ───────────────────────────────────────────────
        hub_px   = None
        rot_raw  = None
        scale_mm = None

        if has_pair:
            b0, b1 = active_pair
            ya     = b0 if b0[1] <= b1[1] else b1
            yb     = b1 if b0[1] <= b1[1] else b0
            hub_px = wheel_hub(ya, yb)

            # Update stable hub (running average over 30 frames)
            hub_buf.append(np.array(hub_px))
            if len(hub_buf) > 30:
                hub_buf.pop(0)
            hub_stable = np.mean(hub_buf, axis=0)

            # Expand ROI to cover all spokes (some appear farther due to perspective)
            hub_radius = max(hub_radius or 0, active_dist / 2 * ROI_FACTOR)

            if active_dist > 0:
                scale_mm = WHEEL_DIAMETER_MM / active_dist   # mm per pixel

        if has_pair and has_orange:
            rot_raw = orange_angle(ora_blobs[0], hub_px)
            # Expand ROI to include observed orange position
            d_ora = math.hypot(ora_blobs[0][0]-hub_stable[0],
                               ora_blobs[0][1]-hub_stable[1])
            hub_radius = max(hub_radius or 0, d_ora * 1.15)

        # ── Zero calibration ───────────────────────────────────────────────
        # The very first time orange is found, record its angle as 0 deg.
        # Every subsequent angle is reported relative to this starting position.
        if rot_raw is not None and zero_offset is None:
            zero_offset = rot_raw
            log.info(f"[DETECT] Zero offset set at t={t_sec:.2f}s: {zero_offset:.1f} deg")

        rot_zeroed = ((rot_raw - zero_offset) % 360
                      if (rot_raw is not None and zero_offset is not None)
                      else None)

        # ── Circular-mean smoothing ────────────────────────────────────────
        if rot_zeroed is not None:
            rot_buf.append(rot_zeroed)
            if len(rot_buf) > SMOOTH_N:
                rot_buf.pop(0)
            rot_smooth = math.degrees(math.atan2(
                np.mean([math.sin(math.radians(x)) for x in rot_buf]),
                np.mean([math.cos(math.radians(x)) for x in rot_buf]),
            )) % 360
        else:
            rot_smooth = rot_buf[-1] if rot_buf else None

        # ── Cumulative rotation (unwrapped) ────────────────────────────────
        # unwrap() prevents 359 → 0 from registering as −359 deg jump
        if rot_smooth is not None:
            if rot_prev is not None:
                rot_cum = unwrap(rot_prev, rot_smooth, rot_cum)
            rot_prev = rot_smooth

        # ── Angular velocity ───────────────────────────────────────────────
        if len(rot_buf) >= 2 and fps > 0:
            # Instantaneous velocity from last two smoothed angles
            d_angle = rot_buf[-1] - rot_buf[-2]
            if d_angle >  180: d_angle -= 360
            if d_angle < -180: d_angle += 360
            vel_dps = d_angle * fps                      # degrees per second
            vel_rps = math.radians(vel_dps)              # radians per second

        # ── Confidence ─────────────────────────────────────────────────────
        n_pair  = 2 if has_pair else max(len(yel_blobs), len(red_blobs))
        conf    = compute_confidence(n_pair, has_orange)
        conf_smooth = conf_smooth * 0.6 + conf * 0.4
        conf_disp   = int(round(conf_smooth))

        # ── Sampling ───────────────────────────────────────────────────────
        # Record one data point every (1 / SAMPLES_PER_SECOND) seconds
        if t_sec >= next_sample_at:
            rot_rad_val = math.radians(rot_smooth) if rot_smooth is not None else None
            sample = make_sample(
                job_id         = job_id,
                timestamp_sec  = t_sec,
                rotation_deg   = rot_smooth,
                cumulative_deg = -rot_cum,        # downward spin = positive
                angular_vel_dps= -vel_dps,        # same sign convention
                confidence_pct = conf_disp,
                source         = active_color,
            )
            all_samples.append(sample)
            next_sample_at += sample_interval

            # Periodic flush to DB/CSV (avoids data loss if crash)
            if len(all_samples) % FLUSH_EVERY == 0:
                persist_samples(job_id, all_samples[-FLUSH_EVERY:])
                log.debug(f"[DETECT] Flushed {FLUSH_EVERY} samples at t={t_sec:.1f}s")

        # ── Draw annotated frame ───────────────────────────────────────────
        ann = frame_stab.copy()   # draw on stabilized frame

        # Hub dot (white)
        if hub_stable is not None:
            cv2.circle(ann, (int(hub_stable[0]), int(hub_stable[1])),
                       5, (255,255,255), -1, cv2.LINE_AA)

        # Yellow / red pair connection line
        if has_pair and last_ya and last_yb:
            col = markers[active_color]["color_bgr"] if active_color else (128,128,128)
            cv2.line(ann, last_ya[:2], last_yb[:2], col, 2, cv2.LINE_AA)
            for pt in [last_ya, last_yb]:
                r = pt[4] + 4
                cv2.circle(ann, pt[:2], r, col, 2, cv2.LINE_AA)
                cv2.circle(ann, pt[:2], 3, col, -1)

        # NEON GREEN circle tracking the orange dot
        if has_orange and ora_blobs:
            ora = ora_blobs[0]
            draw_neon_circle(
                ann,
                center    = (ora[0], ora[1]),
                radius    = ora[4] + 6,          # slightly larger than blob
                color     = TRACK_CIRCLE_COLOR,   # neon green from config
                thickness = TRACK_CIRCLE_THICK,
                glow      = TRACK_CIRCLE_GLOW,
            )
            # Label
            cv2.putText(ann, "ORA",
                        (ora[0]+ora[4]+8, ora[1]+5),
                        cv2.FONT_HERSHEY_SIMPLEX, 0.45,
                        TRACK_CIRCLE_COLOR, 1, cv2.LINE_AA)
            # Line from hub to orange
            if hub_stable is not None:
                cv2.line(ann,
                         (int(hub_stable[0]), int(hub_stable[1])),
                         (ora[0], ora[1]),
                         TRACK_CIRCLE_COLOR, 1, cv2.LINE_AA)

        # ── Info bar ───────────────────────────────────────────────────────
        bar = np.full((BAR_HEIGHT, W, 3), (18, 18, 18), dtype=np.uint8)
        cv2.line(bar, (0, 0), (W, 0), (55, 55, 55), 1)

        rot_rad_disp = math.radians(rot_smooth) if rot_smooth is not None else None
        cum_rad_disp = math.radians(-rot_cum)

        draw_info_bar(
            bar       = bar,
            W         = W,
            t_sec     = t_sec,
            rot_deg   = rot_smooth,
            rot_rad   = rot_rad_disp,
            cum_deg   = -rot_cum,
            cum_rad   = cum_rad_disp,
            vel_dps   = -vel_dps,
            vel_rps   = -vel_rps,
            conf      = conf_disp,
            source    = active_color,
            info_level= info_level,
            direction = direction,
            medium    = medium,
        )

        out_vid.write(np.vstack([ann, bar]))

        if fi % 60 == 0:
          rot_str = f"{rot_smooth:.1f}" if rot_smooth is not None else "---"
          log.info(f"  [{fi:4d}/{total}]  t={t_sec:.1f}s  "
                f"rot={rot_str}  "
                f"cum={-rot_cum:.1f}  conf={conf_disp}%")
        fi += 1

    # ── Flush remaining samples ────────────────────────────────────────────
    remainder = len(all_samples) % FLUSH_EVERY
    if remainder > 0:
        persist_samples(job_id, all_samples[-remainder:])

    cap.release()
    out_vid.release()
    log.info(f"[DETECT] Done. {len(all_samples)} samples  →  {out_path}")
    return all_samples
