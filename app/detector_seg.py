"""
detector_seg.py
===============
Wheel rotation detection using YOLOv8-seg (cpica — spoke mask).

Pipeline:
  1. detect_seg()  → binary spoke mask
  2. Hub           = centroid of mask
  3. Spoke tips    = N farthest points from hub on mask boundary
  4. Orange        = tip whose patch has the most orange HSV pixels
  5. Angle         = atan2(orange_tip - hub)
  6. Draw          = mask contour + hub + orange tip + line on frame

No ground bbox, no center class, no ellipse logic.
"""

import cv2
import numpy as np
import math
import logging
from pathlib import Path

log = logging.getLogger(__name__)

# ── Config ─────────────────────────────────────────────────────────────────
YOLO_SEG_WEIGHTS = str(Path(__file__).parent.parent / "best_seg.onnx")
YOLO_SEG_CONF    = 0.25
YOLO_SEG_MASK_TH = 0.45
ONNX_INPUT_SIZE  = 640
YOLO_EVERY       = 2   # run seg every N processed frames
SKIP_FRAMES      = 4   # process every N-th raw frame

# Orange HSV (OpenCV H: 0-180)
# OpenCV: H=0-180, true orange ≈ H=8-18, S>150, V>100
ORA_H_MIN  = 5
ORA_H_MAX  = 18   # strict — wood/table is H=55-95, blue spoke is H=100-130
ORA_S_MIN  = 150  # very vivid only — wood has S=30-70
ORA_V_MIN  = 100
ORA_PATCH  = 25   # half-size of patch to sample at spoke tip (px)

# Spoke tip detection
N_TIPS       = 8    # expected number of spokes
TIP_FRAC     = 0.85
MAX_ORA_JUMP = 600   # px — max jump between frames (reduced to avoid spoke-hopping)
# How far from tip toward hub to search for orange marker
ORA_INSET    = 0.15
# Max angle jump per frame (degrees) — 360/8/2 = 22.5° per spoke half-gap
MAX_ANGLE_JUMP = 30.0  # degrees

# Smoothing
SMOOTH_N   = 4


# ── ONNX helpers ───────────────────────────────────────────────────────────

def load_yolo_seg():
    if not Path(YOLO_SEG_WEIGHTS).exists():
        log.warning(f"[SEG] {YOLO_SEG_WEIGHTS} not found")
        return None
    try:
        import onnxruntime as ort
        try:
            sess = ort.InferenceSession(YOLO_SEG_WEIGHTS,
                providers=["CUDAExecutionProvider","CPUExecutionProvider"])
        except Exception:
            sess = ort.InferenceSession(YOLO_SEG_WEIGHTS,
                providers=["CPUExecutionProvider"])
        log.info(f"[SEG] loaded  provider={sess.get_providers()[0]}")
        return sess
    except Exception as e:
        log.warning(f"[SEG] load failed: {e}")
        return None


def _letterbox(frame):
    h, w = frame.shape[:2]
    scale = ONNX_INPUT_SIZE / max(h, w)
    nw, nh = int(w*scale), int(h*scale)
    pad_x = (ONNX_INPUT_SIZE - nw) // 2
    pad_y = (ONNX_INPUT_SIZE - nh) // 2
    canvas = np.zeros((ONNX_INPUT_SIZE, ONNX_INPUT_SIZE, 3), np.uint8)
    canvas[pad_y:pad_y+nh, pad_x:pad_x+nw] = cv2.resize(frame, (nw, nh))
    blob = canvas[:,:,::-1].astype(np.float32) / 255.0
    return blob.transpose(2,0,1)[np.newaxis], scale, pad_x, pad_y


def detect_seg(sess, frame):
    """
    Returns:
      mask     : np.uint8 H×W binary (or None)
      hub      : (cx, cy) float centroid (or None)
      contour  : largest contour array (or None)
      conf     : float confidence (or 0)
    """
    if sess is None:
        return None, None, None, 0.0, None

    try:
        h_f, w_f = frame.shape[:2]
        blob, scale, pad_x, pad_y = _letterbox(frame)

        outs = sess.run(None, {sess.get_inputs()[0].name: blob})
        # outs[0]: detections [1, 4+nc+32, 8400] or [1, 8400, 4+nc+32]
        # outs[1]: proto      [1, 32, 160, 160]
        det_raw = outs[0]
        proto   = outs[1]  # [1, 32, 160, 160]

        # Transpose to [8400, cols]
        if det_raw.shape[1] < det_raw.shape[2]:
            preds = det_raw[0].T   # was [1, cols, 8400]
        else:
            preds = det_raw[0]     # was [1, 8400, cols]

        # YOLOv8-seg pred format: [cx, cy, w, h, conf, mask_coeff×32]
        best_conf = YOLO_SEG_CONF
        best_pred = None
        for pred in preds:
            conf = float(pred[4])
            if conf > best_conf:
                best_conf = conf
                best_pred = pred

        if best_pred is None:
            return None, None, None, 0.0, None

        # BBox: cx,cy,w,h in letterbox space → convert to xyxy in original frame
        cx_lb, cy_lb, bw_lb, bh_lb = best_pred[0], best_pred[1], best_pred[2], best_pred[3]
        x1 = max(0, int((cx_lb - bw_lb/2 - pad_x) / scale))
        y1 = max(0, int((cy_lb - bh_lb/2 - pad_y) / scale))
        x2 = min(w_f-1, int((cx_lb + bw_lb/2 - pad_x) / scale))
        y2 = min(h_f-1, int((cy_lb + bh_lb/2 - pad_y) / scale))

        # Hub = bbox center (same as ultralytics)
        hub = (float((x1 + x2) / 2), float((y1 + y2) / 2))

        # Decode segmentation mask
        coeffs   = best_pred[5:5+32]
        mask_160 = np.einsum('n,nhw->hw', coeffs, proto[0])
        mask_160 = (1 / (1 + np.exp(-mask_160)))
        mask_160 = (mask_160 > YOLO_SEG_MASK_TH).astype(np.uint8)

        # Crop letterbox padding from 160×160
        s160 = 160 / ONNX_INPUT_SIZE
        nx = int(pad_x * s160); ny = int(pad_y * s160)
        nw_c = max(1, int((ONNX_INPUT_SIZE - 2*pad_x) * s160))
        nh_c = max(1, int((ONNX_INPUT_SIZE - 2*pad_y) * s160))
        nw_c = min(nw_c, 160 - nx); nh_c = min(nh_c, 160 - ny)
        crop = mask_160[ny:ny+nh_c, nx:nx+nw_c]
        mask = cv2.resize(crop, (w_f, h_f), interpolation=cv2.INTER_NEAREST)

        # Clip mask to bbox area only (eliminates noise outside bbox)
        bbox_mask = np.zeros((h_f, w_f), np.uint8)
        cv2.rectangle(bbox_mask, (x1, y1), (x2, y2), 1, -1)
        mask = (mask & bbox_mask).astype(np.uint8)

        if mask.sum() < 50:
            return None, None, None, 0.0, None

        # Morphological cleanup
        kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (5,5))
        mask   = cv2.morphologyEx(mask, cv2.MORPH_CLOSE, kernel)
        mask   = cv2.morphologyEx(mask, cv2.MORPH_OPEN,  kernel)

        # Largest contour
        cnts, _ = cv2.findContours(mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
        contour = max(cnts, key=cv2.contourArea) if cnts else None

        return mask, hub, contour, best_conf, (x1, y1, x2, y2)

    except Exception as e:
        log.warning(f"[SEG] error: {e}")
        return None, None, None, 0.0, None


# ── Spoke tip detection ─────────────────────────────────────────────────────

def find_spoke_tips(mask, hub, n_tips=N_TIPS):
    """
    Find N spoke tips = farthest mask pixel per angular sector.
    Uses all mask pixels (not just contour) for robustness.
    """
    hx, hy = hub
    # All mask pixel coords
    ys, xs = np.where(mask > 0)
    if len(xs) < 10:
        return []
    pts = np.column_stack([xs.astype(float), ys.astype(float)])
    dx = pts[:,0] - hx
    dy = pts[:,1] - hy
    dists  = np.sqrt(dx**2 + dy**2)
    angles = np.arctan2(dy, dx)

    sector_size = 2 * math.pi / n_tips
    tips = []
    for i in range(n_tips):
        lo = -math.pi + i * sector_size
        hi = lo + sector_size
        in_sector = (angles >= lo) & (angles < hi)
        if not in_sector.any():
            continue
        # Farthest point in this sector
        idx = np.argmax(np.where(in_sector, dists, 0))
        tips.append((float(pts[idx,0]), float(pts[idx,1])))

    return tips


# ── Orange detection at tips ────────────────────────────────────────────────

def find_orange_tip(hsv, tips, hub, last_ora=None):
    """
    For each spoke tip, compute an 'orangeness' score.
    Score = weighted count of pixels in H:5-18 range.
    Uses adaptive saturation threshold based on scene content.
    Returns (cx, cy, area, sat, r) of best tip, or None.
    """
    H, W = hsv.shape[:2]
    hx, hy = hub

    scores = []
    blobs  = []

    for (tx, ty) in tips:
        # Sample inset from tip toward hub
        sx = tx + ORA_INSET * (hx - tx)
        sy = ty + ORA_INSET * (hy - ty)
        x0 = max(0, int(sx) - ORA_PATCH)
        x1 = min(W, int(sx) + ORA_PATCH)
        y0 = max(0, int(sy) - ORA_PATCH)
        y1 = min(H, int(sy) + ORA_PATCH)
        patch_h = hsv[y0:y1, x0:x1, 0]
        patch_s = hsv[y0:y1, x0:x1, 1]
        patch_v = hsv[y0:y1, x0:x1, 2]

        if patch_h.size == 0:
            scores.append(0); blobs.append(None); continue

        # Hue mask: strict orange range only
        hue_mask = (patch_h >= ORA_H_MIN) & (patch_h <= ORA_H_MAX)

        # Adaptive saturation: use 60th percentile of patch saturation as floor
        if hue_mask.any():
            sat_vals = patch_s[hue_mask]
            sat_thresh = max(80, int(np.percentile(sat_vals, 40)))
        else:
            sat_thresh = ORA_S_MIN

        orange_mask = hue_mask & (patch_s >= sat_thresh) & (patch_v >= ORA_V_MIN)
        count = int(orange_mask.sum())

        # Orangeness score: pixels × mean saturation (vivid orange scores higher)
        if count > 0:
            mean_sat = float(np.mean(patch_s[orange_mask]))
            score = count * (mean_sat / 255.0)
        else:
            score = 0.0

        log.info(f"[TIP] tip=({tx:.0f},{ty:.0f}) sample=({sx:.0f},{sy:.0f}) "
                 f"px={count} score={score:.0f} "
                 f"H={int(patch_h.mean())} S={int(patch_s.mean())} sat_th={sat_thresh}")

        if count > 0:
            ys_o, xs_o = np.where(orange_mask)
            cx = float(np.mean(xs_o) + x0)
            cy = float(np.mean(ys_o) + y0)
            sat = int(np.mean(patch_s[orange_mask]))
            r   = max(5, int(math.sqrt(count / math.pi)))
            blobs.append((cx, cy, float(count), sat, r))
        else:
            blobs.append(None)

        scores.append(score)

    if not scores or max(scores) < 5:
        return None

    best_idx  = int(np.argmax(scores))
    best_blob = blobs[best_idx]
    if best_blob is None:
        return None

    log.info(f"[ORA] best tip #{best_idx} score={scores[best_idx]:.0f} "
             f"pos=({best_blob[0]:.0f},{best_blob[1]:.0f})")

    # Stabilization
    if last_ora is not None:
        jump = math.hypot(best_blob[0]-last_ora[0], best_blob[1]-last_ora[1])
        if jump > MAX_ORA_JUMP:
            log.info(f"[ORA] rejected jump={jump:.0f}px")
            return None

    return best_blob


# ── Angle math ─────────────────────────────────────────────────────────────

def orange_angle(ora, hub):
    return math.degrees(math.atan2(ora[0]-hub[0], -(ora[1]-hub[1]))) % 360

def unwrap(prev, curr, cum):
    d = curr - prev
    if d >  180: d -= 360
    if d < -180: d += 360
    return cum + d




# ── Multi-color tip detection ───────────────────────────────────────────────
# HSV ranges for each marker color (H in OpenCV: 0-180)
TIP_COLORS = {
    "orange": {"h_lo": 5,   "h_hi": 18,  "s_min": 100, "v_min": 80,  "bgr": (0,  120, 255)},
    "red":    {"h_lo": 0,   "h_hi": 5,   "s_min": 100, "v_min": 80,  "bgr": (0,   0,  220), "h_lo2": 170, "h_hi2": 180},
    "yellow": {"h_lo": 20,  "h_hi": 35,  "s_min": 100, "v_min": 100, "bgr": (0,  220, 220)},
    "green":  {"h_lo": 40,  "h_hi": 80,  "s_min": 80,  "v_min": 60,  "bgr": (0,  200,  60)},
}

def _color_score(patch_h, patch_s, patch_v, cdef):
    """Score how well a patch matches a color definition."""
    if patch_h.size == 0:
        return 0.0, None
    mask = (patch_h >= cdef["h_lo"]) & (patch_h <= cdef["h_hi"])
    # red wraps around 180
    if "h_lo2" in cdef:
        mask |= (patch_h >= cdef["h_lo2"]) & (patch_h <= cdef["h_hi2"])
    mask &= (patch_s >= cdef["s_min"]) & (patch_v >= cdef["v_min"])
    count = int(mask.sum())
    if count < 3:
        return 0.0, None
    score = count * float(np.mean(patch_s[mask])) / 255.0
    return score, mask


def find_all_tip_colors(hsv, tips, hub):
    """
    For each spoke tip, detect which color marker is present.
    Returns list of dicts: [{tip, color, score, cx, cy, bgr}, ...]
    Only returns tips where a color was clearly detected.
    """
    H, W = hsv.shape[:2]
    hx, hy = hub
    results = []

    for (tx, ty) in tips:
        sx = tx + ORA_INSET * (hx - tx)
        sy = ty + ORA_INSET * (hy - ty)
        x0 = max(0, int(sx) - ORA_PATCH)
        x1 = min(W, int(sx) + ORA_PATCH)
        y0 = max(0, int(sy) - ORA_PATCH)
        y1 = min(H, int(sy) + ORA_PATCH)

        patch_h = hsv[y0:y1, x0:x1, 0]
        patch_s = hsv[y0:y1, x0:x1, 1]
        patch_v = hsv[y0:y1, x0:x1, 2]

        best_color = None
        best_score = 5.0  # minimum threshold
        best_mask  = None

        for cname, cdef in TIP_COLORS.items():
            score, cmask = _color_score(patch_h, patch_s, patch_v, cdef)
            if score > best_score:
                best_score = score
                best_color = cname
                best_mask  = cmask

        if best_color is not None and best_mask is not None:
            ys_c, xs_c = np.where(best_mask)
            cx = float(np.mean(xs_c) + x0)
            cy = float(np.mean(ys_c) + y0)
            results.append({
                "tip":   (tx, ty),
                "color": best_color,
                "score": best_score,
                "cx":    cx,
                "cy":    cy,
                "bgr":   TIP_COLORS[best_color]["bgr"],
            })

    return results

# ── Drawing ─────────────────────────────────────────────────────────────────

def draw_seg_overlay(ann, mask, hub, contour, tips, ora_blob, rot_smooth, rot_cum, bbox=None, tip_colors=None):
    """Draw seg detection on ann (in-place). Neon green circle style."""
    NEON    = (0, 255, 128)   # neon green BGR
    NEON_DIM= (0, 120, 60)
    CYAN    = (0, 220, 220)
    ORANGE_BGR = (0, 100, 255)

    # ── Neon green circle around wheel (inscribed in seg bbox) ────────────
    if contour is not None and hub is not None:
        hx, hy = int(hub[0]), int(hub[1])
        # Compute radius from hub to farthest contour point
        pts = contour.reshape(-1, 2).astype(float)
        dists = np.sqrt((pts[:,0]-hx)**2 + (pts[:,1]-hy)**2)
        r = int(np.percentile(dists, 90))  # 90th percentile avoids outliers
        if r > 5:
            # Glow effect: outer dim ring
            cv2.circle(ann, (hx, hy), r+4, NEON_DIM, 2, cv2.LINE_AA)
            cv2.circle(ann, (hx, hy), r+2, NEON_DIM, 1, cv2.LINE_AA)
            # Main neon circle
            cv2.circle(ann, (hx, hy), r, NEON, 2, cv2.LINE_AA)

    # Hub dot
    if hub is not None:
        hx, hy = int(hub[0]), int(hub[1])
        cv2.circle(ann, (hx, hy), 7, (0,0,0), -1, cv2.LINE_AA)
        cv2.circle(ann, (hx, hy), 5, NEON, -1, cv2.LINE_AA)

    # Draw all detected color markers
    if tip_colors and hub is not None:
        hx2, hy2 = int(hub[0]), int(hub[1])
        for tc in tip_colors:
            mx, my = int(tc["cx"]), int(tc["cy"])
            bgr = tc["bgr"]
            bgr_dim = tuple(int(c * 0.3) for c in bgr)
            cv2.line(ann, (hx2, hy2), (mx, my), bgr_dim, 1, cv2.LINE_AA)
            cv2.circle(ann, (mx, my), 13, (0, 0, 0), -1, cv2.LINE_AA)
            cv2.circle(ann, (mx, my), 11, bgr,        -1, cv2.LINE_AA)
            cv2.circle(ann, (mx, my),  9, bgr_dim,     1, cv2.LINE_AA)
            cv2.putText(ann, tc["color"][:3].upper(), (mx+13, my+4),
                        cv2.FONT_HERSHEY_SIMPLEX, 0.32, bgr, 1, cv2.LINE_AA)
    elif ora_blob is not None and hub is not None:
        ox, oy = int(ora_blob[0]), int(ora_blob[1])
        hx, hy = int(hub[0]), int(hub[1])
        cv2.line(ann, (hx,hy), (ox,oy), NEON_DIM, 1, cv2.LINE_AA)
        cv2.circle(ann, (ox,oy), 13, (0,0,0),    -1, cv2.LINE_AA)
        cv2.circle(ann, (ox,oy), 11, ORANGE_BGR,  -1, cv2.LINE_AA)
        cv2.circle(ann, (ox,oy), 11, (0, 60, 180), 2, cv2.LINE_AA)

    # Angle text box
    if rot_smooth is not None:
        ang = f"{rot_smooth:.1f}"
        cum = f"{-rot_cum:+.1f}"
        W = ann.shape[1]
        # Semi-transparent bg
        overlay = ann.copy()
        cv2.rectangle(overlay, (6,6), (160,62), (0,0,0), -1)
        cv2.addWeighted(overlay, 0.55, ann, 0.45, 0, ann)
        cv2.putText(ann, ang + u"°", (12,32), cv2.FONT_HERSHEY_SIMPLEX,
                    0.95, CYAN, 2, cv2.LINE_AA)
        col = NEON if rot_cum <= 0 else (0,100,255)
        cv2.putText(ann, cum + u"°", (12,56), cv2.FONT_HERSHEY_SIMPLEX,
                    0.78, col, 2, cv2.LINE_AA)