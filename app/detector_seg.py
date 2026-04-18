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
SKIP_FRAMES      = 2   # process every N-th raw frame

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
MAX_ORA_JUMP = 120  # px — stabilization
# How far from tip toward hub to search for orange marker
# 0.0 = exactly at tip, 0.15 = 15% toward center (≈3mm inset)
ORA_INSET    = 0.15

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

        # log.info(f"[TIP] tip=({tx:.0f},{ty:.0f}) sample=({sx:.0f},{sy:.0f}) "
        #          f"px={count} score={score:.0f} "
        #          f"H={int(patch_h.mean())} S={int(patch_s.mean())} sat_th={sat_thresh}")

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

    # log.info(f"[ORA] best tip #{best_idx} score={scores[best_idx]:.0f} "
    #          f"pos=({best_blob[0]:.0f},{best_blob[1]:.0f})")

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


# ── Drawing ─────────────────────────────────────────────────────────────────

def draw_seg_overlay(ann, mask, hub, contour, tips, ora_blob, rot_smooth, rot_cum, bbox=None):
    """Draw seg detection on ann (in-place)."""
    PURPLE = (220, 0, 255)
    CYAN   = (0, 220, 220)
    ORANGE_BGR = (0, 100, 255)

    # Semi-transparent mask fill
    if mask is not None:
        overlay = ann.copy()
        overlay[mask > 0] = (overlay[mask > 0] * 0.5 + np.array([80, 0, 120]) * 0.5).astype(np.uint8)
        cv2.addWeighted(overlay, 0.4, ann, 0.6, 0, ann)

    # Contour outline
    if contour is not None:
        cv2.drawContours(ann, [contour], -1, PURPLE, 2, cv2.LINE_AA)

    # Spoke tips (small dots)
    for (tx, ty) in (tips or []):
        cv2.circle(ann, (int(tx), int(ty)), 5, (100, 100, 255), -1, cv2.LINE_AA)

    # YOLO bbox (debug) — green like ultralytics
    if bbox is not None:
        bx1, by1, bx2, by2 = bbox
        cv2.rectangle(ann, (bx1, by1), (bx2, by2), (0, 255, 0), 2, cv2.LINE_AA)
        bcx, bcy = (bx1+bx2)//2, (by1+by2)//2
        cv2.circle(ann, (bcx, bcy), 5, (0, 255, 0), -1, cv2.LINE_AA)
        cv2.putText(ann, f"bbox {bx2-bx1}x{by2-by1}", (bx1, by1-4),
                    cv2.FONT_HERSHEY_SIMPLEX, 0.4, (0,255,0), 1, cv2.LINE_AA)

    # Hub crosshair
    if hub is not None:
        hx, hy = int(hub[0]), int(hub[1])
        arm = 14
        cv2.line(ann, (hx-arm, hy), (hx+arm, hy), CYAN, 2, cv2.LINE_AA)
        cv2.line(ann, (hx, hy-arm), (hx, hy+arm), CYAN, 2, cv2.LINE_AA)
        cv2.circle(ann, (hx, hy), 5, CYAN, -1, cv2.LINE_AA)

    # Orange marker
    if ora_blob is not None and hub is not None:
        ox, oy = int(ora_blob[0]), int(ora_blob[1])
        hx, hy = int(hub[0]), int(hub[1])
        # Line hub→orange
        cv2.line(ann, (hx,hy), (ox,oy), (0,200,150), 1, cv2.LINE_AA)
        # Orange circle
        cv2.circle(ann, (ox,oy), 12, (0,40,120), -1, cv2.LINE_AA)
        cv2.circle(ann, (ox,oy), 10, ORANGE_BGR, -1, cv2.LINE_AA)
        cv2.circle(ann, (ox,oy), 10, (0,60,200),  1, cv2.LINE_AA)
        cv2.putText(ann, "ORA", (ox+13, oy+4),
                    cv2.FONT_HERSHEY_SIMPLEX, 0.4, ORANGE_BGR, 1, cv2.LINE_AA)

    # Angle text box
    if rot_smooth is not None:
        ang = f"{rot_smooth:.1f}°"
        cum = f"{-rot_cum:+.1f}°"
        cv2.rectangle(ann, (6,6), (150,58), (0,0,0), -1)
        cv2.putText(ann, ang, (12,30), cv2.FONT_HERSHEY_SIMPLEX,
                    0.9, (0,220,220), 2, cv2.LINE_AA)
        col = (0,255,128) if rot_cum <= 0 else (0,100,255)
        cv2.putText(ann, cum, (12,52), cv2.FONT_HERSHEY_SIMPLEX,
                    0.75, col, 2, cv2.LINE_AA)