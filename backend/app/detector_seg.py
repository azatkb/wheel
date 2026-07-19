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
ORA_H_MIN  = 13
ORA_H_MAX  = 26
ORA_S_MIN  = 120
ORA_V_MIN  = 80

def set_medium(m):
    """Tune orange detection for the recording medium. Call before processing a video.
    Water: pale/washed-out underwater orange → lower saturation floor.
    Air:   strict saturation (reject red / red-orange).
    Hue is kept tight around the real orange (~20) both ways, so RED (hue 0-5 / 170-180)
    is never picked up as orange."""
    global ORA_H_MIN, ORA_H_MAX, ORA_S_MIN, ORA_V_MIN
    if str(m or "").lower() == "water":
        ORA_H_MIN, ORA_H_MAX, ORA_S_MIN, ORA_V_MIN = 12, 28, 70, 60
    else:
        ORA_H_MIN, ORA_H_MAX, ORA_S_MIN, ORA_V_MIN = 13, 26, 120, 80


def verify_orange_at(hsv, x, y, r=18):
    """Probabilistic colour check at a point: is the marker here really ORANGE
    (and not red or yellow)?  Used to veto YOLO's 'orange' class, because the
    model can confuse the red marker with orange (esp. underwater).
    Returns True only if orange is the most probable warm colour at (x, y)."""
    H, W = hsv.shape[:2]
    x0, x1 = max(0, int(x) - r), min(W, int(x) + r)
    y0, y1 = max(0, int(y) - r), min(H, int(y) + r)
    if x1 <= x0 or y1 <= y0:
        return False
    ph = hsv[y0:y1, x0:x1, 0].astype(np.float32)
    ps = hsv[y0:y1, x0:x1, 1].astype(np.float32)
    pv = hsv[y0:y1, x0:x1, 2].astype(np.float32)
    REF = {"red": 178.0, "orange": 20.0, "yellow": 33.0}
    SIG = 7.0
    def _d(h, ref):
        d = np.abs(h - ref)
        return np.minimum(d, 180.0 - d)
    warm = ((_d(ph, REF["orange"]) < 3*SIG) | (_d(ph, REF["red"]) < 2*SIG) |
            (_d(ph, REF["yellow"]) < 2*SIG))
    warm &= (ps >= ORA_S_MIN) & (pv >= ORA_V_MIN)
    if int(warm.sum()) < 5:
        return False
    if float(np.median(ps[warm])) < 60:      # grey warm glare — not a marker
        return False
    hv = ph[warm]
    p = {c: np.exp(-(_d(hv, rf) ** 2) / (2 * SIG ** 2)) for c, rf in REF.items()}
    tot = p["red"] + p["orange"] + p["yellow"] + 1e-9
    po = float(np.mean(p["orange"] / tot))
    pr = float(np.mean(p["red"]    / tot))
    py = float(np.mean(p["yellow"] / tot))
    return po > pr and po > py
ORA_PATCH  = 25

# Spoke tip detection
N_TIPS         = 8
TIP_FRAC       = 0.85
MAX_ORA_JUMP   = 60
ORA_INSET      = 0.17
MAX_ANGLE_JUMP = 30.0

# Smoothing
SMOOTH_N = 4


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
      bbox     : (x1,y1,x2,y2) or None
    """
    if sess is None:
        return None, None, None, 0.0, None

    try:
        h_f, w_f = frame.shape[:2]
        blob, scale, pad_x, pad_y = _letterbox(frame)

        outs = sess.run(None, {sess.get_inputs()[0].name: blob})
        det_raw = outs[0]
        proto   = outs[1]

        if det_raw.shape[1] < det_raw.shape[2]:
            preds = det_raw[0].T
        else:
            preds = det_raw[0]

        # nc = number of classes (cols - 4 bbox - 32 mask)
        nc = max(1, preds.shape[1] - 4 - 32)
        log.info(f"[SEG] nc={nc} preds={preds.shape}")

        best_conf   = YOLO_SEG_CONF
        best_pred   = None   # class 0: cpica (spoke mask)
        orange_pred = None   # class 1: orange marker
        orange_conf = YOLO_SEG_CONF

        for pred in preds:
            if nc == 1:
                conf = float(pred[4]); cls = 0
            else:
                cls_scores = pred[4:4+nc]
                cls  = int(np.argmax(cls_scores))
                conf = float(cls_scores[cls])
            if cls == 0 and conf > best_conf:
                best_conf = conf; best_pred = pred
            elif nc > 1 and cls == 1 and conf > orange_conf:
                orange_conf = conf; orange_pred = pred

        if best_pred is None:
            return None, None, None, 0.0, None, None

        cx_lb, cy_lb, bw_lb, bh_lb = best_pred[0], best_pred[1], best_pred[2], best_pred[3]
        x1 = max(0, int((cx_lb - bw_lb/2 - pad_x) / scale))
        y1 = max(0, int((cy_lb - bh_lb/2 - pad_y) / scale))
        x2 = min(w_f-1, int((cx_lb + bw_lb/2 - pad_x) / scale))
        y2 = min(h_f-1, int((cy_lb + bh_lb/2 - pad_y) / scale))

        hub = (float((x1 + x2) / 2), float((y1 + y2) / 2))

        # mask coeffs start after bbox(4) + classes(nc)
        coeffs   = best_pred[4+nc:4+nc+32]
        mask_160 = np.einsum('n,nhw->hw', coeffs, proto[0])
        mask_160 = (1 / (1 + np.exp(-mask_160)))
        mask_160 = (mask_160 > YOLO_SEG_MASK_TH).astype(np.uint8)

        s160 = 160 / ONNX_INPUT_SIZE
        nx = int(pad_x * s160); ny = int(pad_y * s160)
        nw_c = max(1, int((ONNX_INPUT_SIZE - 2*pad_x) * s160))
        nh_c = max(1, int((ONNX_INPUT_SIZE - 2*pad_y) * s160))
        nw_c = min(nw_c, 160 - nx); nh_c = min(nh_c, 160 - ny)
        crop = mask_160[ny:ny+nh_c, nx:nx+nw_c]
        mask = cv2.resize(crop, (w_f, h_f), interpolation=cv2.INTER_NEAREST)

        bbox_mask = np.zeros((h_f, w_f), np.uint8)
        cv2.rectangle(bbox_mask, (x1, y1), (x2, y2), 1, -1)
        mask = (mask & bbox_mask).astype(np.uint8)

        if mask.sum() < 50:
            return None, None, None, 0.0, None

        kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (5,5))
        mask   = cv2.morphologyEx(mask, cv2.MORPH_CLOSE, kernel)
        mask   = cv2.morphologyEx(mask, cv2.MORPH_OPEN,  kernel)

        cnts, _ = cv2.findContours(mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
        contour = max(cnts, key=cv2.contourArea) if cnts else None

        # Parse orange bbox if detected
        yolo_orange = None
        if orange_pred is not None:
            ox_lb = float(orange_pred[0]); oy_lb = float(orange_pred[1])
            ow_lb = float(orange_pred[2]); oh_lb = float(orange_pred[3])
            ox1 = max(0, int((ox_lb - ow_lb/2 - pad_x) / scale))
            oy1 = max(0, int((oy_lb - oh_lb/2 - pad_y) / scale))
            ox2 = min(w_f-1, int((ox_lb + ow_lb/2 - pad_x) / scale))
            oy2 = min(h_f-1, int((oy_lb + oh_lb/2 - pad_y) / scale))
            ocx = float((ox1+ox2)/2); ocy = float((oy1+oy2)/2)
            r   = max(5, int(math.hypot(ox2-ox1, oy2-oy1)/2))
            yolo_orange = (ocx, ocy, float(r*2), int(orange_conf*100), r)
            log.info(f"[SEG] YOLO orange at ({ocx:.0f},{ocy:.0f}) conf={orange_conf:.2f}")

        return mask, hub, contour, best_conf, (x1, y1, x2, y2), yolo_orange

    except Exception as e:
        log.warning(f"[SEG] error: {e}")
        return None, None, None, 0.0, None, None


# ── Spoke tip detection ─────────────────────────────────────────────────────

def find_spoke_tips(mask, hub, n_tips=N_TIPS):
    hx, hy = hub
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
        idx = np.argmax(np.where(in_sector, dists, 0))
        tips.append((float(pts[idx,0]), float(pts[idx,1])))

    return tips


# ── Orange detection at tips ────────────────────────────────────────────────

def find_orange_tip(hsv, tips, hub, last_ora=None):
    """Probabilistic warm-marker classification.
    For every spoke tip we detect ALL warm pixels (yellow + orange + red bands)
    and compute, from the circular hue distance to each reference hue, the
    probability that the tip's marker is yellow / orange / red.
    The tip chosen as "orange" is the one with the highest P(orange) AND where
    orange is more probable than red and yellow.  This is robust underwater,
    where colours fade: even a pale orange stays closest to the orange hue."""
    H, W = hsv.shape[:2]
    hx, hy = hub

    # Reference hues (OpenCV 0-180), measured from real frames:
    #   red ≈ 177 (wraps to ~0-5), orange ≈ 20, yellow ≈ 33
    REF = {"red": 178.0, "orange": 20.0, "yellow": 33.0}
    SIGMA = 7.0   # hue tolerance (gaussian width)

    def _hue_dist(h, ref):
        d = np.abs(h - ref)
        return np.minimum(d, 180.0 - d)   # circular distance

    scores = []   # P(orange)-weighted pixel score per tip
    blobs  = []

    for (tx, ty) in tips:
        sx = tx + ORA_INSET * (hx - tx)
        sy = ty + ORA_INSET * (hy - ty)
        x0 = max(0, int(sx) - ORA_PATCH)
        x1 = min(W, int(sx) + ORA_PATCH)
        y0 = max(0, int(sy) - ORA_PATCH)
        y1 = min(H, int(sy) + ORA_PATCH)
        patch_h = hsv[y0:y1, x0:x1, 0].astype(np.float32)
        patch_s = hsv[y0:y1, x0:x1, 1].astype(np.float32)
        patch_v = hsv[y0:y1, x0:x1, 2].astype(np.float32)

        if patch_h.size == 0:
            scores.append(0.0); blobs.append(None); continue

        # Warm pixels = anything near yellow/orange/red, saturated enough to be a marker.
        warm = ((_hue_dist(patch_h, REF["orange"]) < 3*SIGMA) |
                (_hue_dist(patch_h, REF["red"])    < 2*SIGMA) |
                (_hue_dist(patch_h, REF["yellow"]) < 2*SIGMA))
        warm &= (patch_s >= ORA_S_MIN) & (patch_v >= ORA_V_MIN)

        n_warm = int(warm.sum())
        if n_warm < 5:
            scores.append(0.0); blobs.append(None); continue

        # SATURATION EVIDENCE GATE: a real painted marker is clearly saturated;
        # grey warm-hued glare (S≈10-20, like bowl reflections) must never win,
        # in any medium. Absolute floor: 60.
        med_warm_sat = float(np.median(patch_s[warm]))
        if med_warm_sat < 60:
            scores.append(0.0); blobs.append(None); continue

        hvals = patch_h[warm]
        # Class likelihoods per pixel (gaussian on circular hue distance)
        p = {c: np.exp(-(_hue_dist(hvals, r) ** 2) / (2 * SIGMA ** 2))
             for c, r in REF.items()}
        tot = p["red"] + p["orange"] + p["yellow"] + 1e-9
        p_orange_px = p["orange"] / tot           # per-pixel P(orange)
        p_orange = float(np.mean(p_orange_px))    # tip-level probability
        p_red    = float(np.mean(p["red"]    / tot))
        p_yellow = float(np.mean(p["yellow"] / tot))

        # Orange must be the most probable class for this tip.
        if p_orange <= max(p_red, p_yellow):
            scores.append(0.0); blobs.append(None); continue

        # Blob = centroid of the orange-probable pixels
        om = np.zeros_like(warm)
        om[warm] = p_orange_px > 0.5
        if int(om.sum()) < 3:
            om = warm  # fall back to all warm pixels (still orange-classified tip)
        ys_o, xs_o = np.where(om)
        cx = float(np.mean(xs_o) + x0)
        cy = float(np.mean(ys_o) + y0)
        sat = int(np.mean(patch_s[om]))
        cnt = float(om.sum())
        r   = max(5, int(math.sqrt(cnt / math.pi)))
        blobs.append((cx, cy, cnt, sat, r))
        # Score: confidence × amount of evidence
        scores.append(p_orange * cnt)

    if not scores or max(scores) <= 0:
        return None

    best_idx  = int(np.argmax(scores))
    best_blob = blobs[best_idx]
    if best_blob is None:
        return None

    # Reject if outside wheel radius
    if tips and hub is not None:
        hx2, hy2 = hub
        tip_dists = [math.hypot(tx-hx2, ty-hy2) for tx,ty in tips]
        max_tip_r = max(tip_dists) * 1.15
        ora_dist  = math.hypot(best_blob[0]-hx2, best_blob[1]-hy2)
        if ora_dist > max_tip_r:
            return None

    if last_ora is not None:
        jump = math.hypot(best_blob[0]-last_ora[0], best_blob[1]-last_ora[1])
        if jump > MAX_ORA_JUMP:
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

TIP_COLORS = {
    "orange": {"h_lo": 13,  "h_hi": 26,  "s_min": 100, "v_min": 80,  "bgr": (0,  120, 255)},
    "red":    {"h_lo": 0,   "h_hi": 5,   "s_min": 100, "v_min": 80,  "bgr": (0,   0,  220), "h_lo2": 170, "h_hi2": 180},
    "yellow": {"h_lo": 20,  "h_hi": 35,  "s_min": 100, "v_min": 100, "bgr": (0,  220, 220)},
    "green":  {"h_lo": 40,  "h_hi": 80,  "s_min": 80,  "v_min": 60,  "bgr": (0,  200,  60)},
}

def _color_score(patch_h, patch_s, patch_v, cdef):
    if patch_h.size == 0:
        return 0.0, None
    mask = (patch_h >= cdef["h_lo"]) & (patch_h <= cdef["h_hi"])
    if "h_lo2" in cdef:
        mask |= (patch_h >= cdef["h_lo2"]) & (patch_h <= cdef["h_hi2"])
    mask &= (patch_s >= cdef["s_min"]) & (patch_v >= cdef["v_min"])
    count = int(mask.sum())
    if count < 3:
        return 0.0, None
    score = count * float(np.mean(patch_s[mask])) / 255.0
    return score, mask


def find_all_tip_colors(hsv, tips, hub):
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
        best_score = 5.0
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

    MAX_PER_COLOR = {"orange": 1, "red": 2, "yellow": 2, "green": 2}
    from collections import defaultdict
    by_color = defaultdict(list)
    for r in results:
        by_color[r["color"]].append(r)
    deduped = []
    for color, items in by_color.items():
        items.sort(key=lambda x: -x["score"])
        deduped.extend(items[:MAX_PER_COLOR.get(color, 1)])
    return deduped


# ── Drawing ─────────────────────────────────────────────────────────────────

def draw_seg_overlay(ann, mask, hub, contour, tips, ora_blob, rot_smooth, rot_cum, bbox=None, tip_colors=None, draw_mesh=True):
    """Draw seg detection on ann (in-place). Neon green circle style."""
    NEON       = (0, 255, 128)
    NEON_DIM   = (0, 120, 60)
    CYAN       = (0, 220, 220)
    ORANGE_BGR = (0, 100, 255)
    MESH       = (0, 180, 80)

    # Spoke mesh
    if draw_mesh and hub is not None and tips:
        hx, hy = int(hub[0]), int(hub[1])
        for (tx, ty) in tips:
            cv2.line(ann, (hx, hy), (int(tx), int(ty)), NEON_DIM, 1, cv2.LINE_AA)
        tip_pts = [(int(tx), int(ty)) for tx, ty in tips]
        for i in range(len(tip_pts)):
            cv2.line(ann, tip_pts[i], tip_pts[(i+1) % len(tip_pts)], NEON_DIM, 1, cv2.LINE_AA)
        for p in tip_pts:
            cv2.circle(ann, p, 3, MESH, -1, cv2.LINE_AA)

    # Neon green circle
    if contour is not None and hub is not None:
        hx, hy = int(hub[0]), int(hub[1])
        pts = contour.reshape(-1, 2).astype(float)
        dists = np.sqrt((pts[:,0]-hx)**2 + (pts[:,1]-hy)**2)
        r = int(np.percentile(dists, 90))
        if r > 5:
            cv2.circle(ann, (hx, hy), r+4, NEON_DIM, 2, cv2.LINE_AA)
            cv2.circle(ann, (hx, hy), r+2, NEON_DIM, 1, cv2.LINE_AA)
            cv2.circle(ann, (hx, hy), r,   NEON,     2, cv2.LINE_AA)

    # Hub dot
    if hub is not None:
        hx, hy = int(hub[0]), int(hub[1])
        cv2.circle(ann, (hx, hy), 7, (0,0,0), -1, cv2.LINE_AA)
        cv2.circle(ann, (hx, hy), 5, NEON,    -1, cv2.LINE_AA)

    # Color markers
    if tip_colors and hub is not None:
        hx2, hy2 = int(hub[0]), int(hub[1])
        for tc in tip_colors:
            mx, my = int(tc["cx"]), int(tc["cy"])
            bgr = tc["bgr"]
            bgr_dim = tuple(int(c * 0.3) for c in bgr)
            cv2.line(ann, (hx2, hy2), (mx, my), bgr_dim, 1, cv2.LINE_AA)
            cv2.circle(ann, (mx, my), 13, (0,0,0), -1, cv2.LINE_AA)
            cv2.circle(ann, (mx, my), 11, bgr,      -1, cv2.LINE_AA)
            cv2.circle(ann, (mx, my),  9, bgr_dim,   1, cv2.LINE_AA)
            cv2.putText(ann, tc["color"][:3].upper(), (mx+13, my+4),
                        cv2.FONT_HERSHEY_SIMPLEX, 0.32, bgr, 1, cv2.LINE_AA)
    elif ora_blob is not None and hub is not None:
        ox, oy = int(ora_blob[0]), int(ora_blob[1])
        hx, hy = int(hub[0]), int(hub[1])
        cv2.line(ann, (hx,hy), (ox,oy), NEON_DIM, 1, cv2.LINE_AA)
        cv2.circle(ann, (ox,oy), 13, (0,0,0),    -1, cv2.LINE_AA)
        cv2.circle(ann, (ox,oy), 11, ORANGE_BGR,  -1, cv2.LINE_AA)
        cv2.circle(ann, (ox,oy), 11, (0,60,180),   2, cv2.LINE_AA)

    # Angle text
    if rot_smooth is not None:
        overlay = ann.copy()
        cv2.rectangle(overlay, (6,6), (160,62), (0,0,0), -1)
        cv2.addWeighted(overlay, 0.55, ann, 0.45, 0, ann)
        cv2.putText(ann, f"{rot_smooth:.1f}\u00b0", (12,32),
                    cv2.FONT_HERSHEY_SIMPLEX, 0.95, CYAN, 2, cv2.LINE_AA)
        col = NEON if rot_cum <= 0 else (0,100,255)
        cv2.putText(ann, f"{-rot_cum:+.1f}\u00b0", (12,56),
                    cv2.FONT_HERSHEY_SIMPLEX, 0.78, col, 2, cv2.LINE_AA)