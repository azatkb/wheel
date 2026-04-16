"""
detector.py
===========
Core wheel rotation detection.

Detection priority:
  1. ONNX center  → hub (wheel center)
  2. ONNX orange  → rotation reference (color-verified)
  3. OpenCV orange → fallback
  4. OpenCV yellow/red pair → hub fallback (DISABLED)

Progress callback sends lightweight JSON with detection coordinates.
Browser draws overlay on canvas — no JPEG transfer needed.

SKIP_FRAMES: process every N-th frame (1=all, 4=4x faster).
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
USE_YOLO          = True
USE_PAIR_FALLBACK = False

# ── ONNX config ────────────────────────────────────────────────────────────
YOLO_WEIGHTS    = "best.onnx"
YOLO_CONF       = 0.35
YOLO_CLASSES    = ["center", "ground", "orange"]  # order from data.yaml: 0=center 1=ground 2=orange
YOLO_EVERY      = 2
ONNX_INPUT_SIZE = 640

# ── Speed config ───────────────────────────────────────────────────────────
SKIP_FRAMES = 1   # 1=every frame, 4=4x faster

# Orange HSV verification
ORANGE_H_LO  = 8
ORANGE_H_HI  = 22
ORANGE_S_MIN = 80

# ── OpenCV HSV ranges ──────────────────────────────────────────────────────
def _u(h, s, v):
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


# ── ONNX ───────────────────────────────────────────────────────────────────

def load_yolo():
    if not USE_YOLO or not Path(YOLO_WEIGHTS).exists():
        log.warning(f"[ONNX] {YOLO_WEIGHTS} not found — OpenCV only")
        return None
    try:
        import onnxruntime as ort
        # Try CUDA first, fall back to CPU silently
        # On Windows without CUDA drivers use CPU only
        try:
            session = ort.InferenceSession(YOLO_WEIGHTS,
                providers=["CUDAExecutionProvider","CPUExecutionProvider"])
        except Exception:
            session = ort.InferenceSession(YOLO_WEIGHTS,
                providers=["CPUExecutionProvider"])
        log.info(f"[ONNX] loaded  provider={session.get_providers()[0]}")
        return session
    except Exception as e:
        log.warning(f"[ONNX] load failed: {e}")
        return None


def _preprocess_onnx(frame):
    """
    Letterbox resize to ONNX_INPUT_SIZE x ONNX_INPUT_SIZE.
    Returns (blob, scale, pad_x, pad_y) so coordinates can be
    correctly mapped back: orig_x = (pred_x - pad_x) / scale
    """
    h, w = frame.shape[:2]
    scale = ONNX_INPUT_SIZE / max(h, w)
    nw, nh = int(w*scale), int(h*scale)
    # Center padding (letterbox)
    pad_x = (ONNX_INPUT_SIZE - nw) // 2
    pad_y = (ONNX_INPUT_SIZE - nh) // 2
    canvas = np.zeros((ONNX_INPUT_SIZE, ONNX_INPUT_SIZE, 3), np.uint8)
    canvas[pad_y:pad_y+nh, pad_x:pad_x+nw] = cv2.resize(frame, (nw, nh))
    blob = canvas[:,:,::-1].astype(np.float32)/255.0
    return blob.transpose(2,0,1)[np.newaxis], scale, pad_x, pad_y


def detect_yolo(session, frame, hsv) -> dict:
    result = {"center": None, "orange": None, "ground": None}
    if session is None: return result
    try:
        h_f, w_f = frame.shape[:2]
        blob, scale, pad_x, pad_y = _preprocess_onnx(frame)
        raw = session.run(None, {session.get_inputs()[0].name: blob})[0]
        preds = raw[0].T if (raw.ndim==3 and raw.shape[1]<raw.shape[2]) else raw[0]
        best = {}
        for pred in preds:
            cls  = int(np.argmax(pred[4:]))
            conf = float(pred[4+cls])
            if conf < YOLO_CONF or cls >= len(YOLO_CLASSES): continue
            name = YOLO_CLASSES[cls]
            # Remove letterbox padding before unscaling
            cx = max(0, min(int((pred[0] - pad_x) / scale), w_f-1))
            cy = max(0, min(int((pred[1] - pad_y) / scale), h_f-1))
            bw = max(1, int(pred[2] / scale))
            bh = max(1, int(pred[3] / scale))
            area = max(1, bw * bh)
            r    = max(5, int(math.sqrt(area/math.pi)))
            if name=="orange":
                hv,sv = int(hsv[cy,cx,0]),int(hsv[cy,cx,1])
                if not (ORANGE_H_LO<=hv<=ORANGE_H_HI and sv>=ORANGE_S_MIN):
                    ph=hsv[max(0,cy-4):cy+4,max(0,cx-4):cx+4,0]
                    ps=hsv[max(0,cy-4):cy+4,max(0,cx-4):cx+4,1]
                    if ph.size==0 or not (ORANGE_H_LO<=int(np.median(ph))<=ORANGE_H_HI
                                          and int(np.median(ps))>=ORANGE_S_MIN): continue
            if name not in best or conf>best[name]["conf"]:
                best[name] = {"blob": (cx, cy, area, int(hsv[cy,cx,1]), r), "conf": conf,
                               "wh": (bw, bh)}
        for n,d in best.items():
            if n == "ground":
                cx2,cy2,_,_,_ = d["blob"]
                bw,bh = d.get("wh",(0,0))
                result["ground"] = (cx2, cy2, bw, bh)  # bbox center + size
            elif n == "center":
                # Hub is at bottom-right corner of the "center" bbox
                cx2,cy2,area2,sat2,r2 = d["blob"]
                bw2,bh2 = d.get("wh",(0,0))
                hub_x = cx2 + bw2//2
                hub_y = cy2 + bh2//2
                result["center"] = (hub_x, hub_y, area2, sat2, r2)
            else:
                result[n] = d["blob"]
    except Exception as e:
        log.warning(f"[ONNX] error: {e}")
    return result


# ── OpenCV ─────────────────────────────────────────────────────────────────

def build_ranges(defs):
    result = {}
    for name, d in defs.items():
        lo_cv=_u(*d["lo"]); hi_cv=_u(*d["hi"])
        th=round(d.get("tol_h",0)/2)
        ts=round(d.get("tol_s",0)/100*255)
        tv=round(d.get("tol_v",0)/100*255)
        hl=max(0,min(lo_cv[0],hi_cv[0])-th); hh=min(180,max(lo_cv[0],hi_cv[0])+th)
        sl=max(0,min(lo_cv[1],hi_cv[1])-ts); sh=min(255,max(lo_cv[1],hi_cv[1])+ts)
        vl=max(0,min(lo_cv[2],hi_cv[2])-tv); vh=min(255,max(lo_cv[2],hi_cv[2])+tv)
        lo1=np.array([hl,sl,vl],np.uint8); hi1=np.array([hh,sh,vh],np.uint8)
        lo2=hi2=None
        if hl==0 and min(lo_cv[0],hi_cv[0])-th<0:
            lo2=np.array([max(0,180+(min(lo_cv[0],hi_cv[0])-th)),sl,vl],np.uint8)
            hi2=np.array([180,sh,vh],np.uint8)
        elif hh==180 and max(lo_cv[0],hi_cv[0])+th>180:
            lo2=np.array([0,sl,vl],np.uint8)
            hi2=np.array([(max(lo_cv[0],hi_cv[0])+th)-180,sh,vh],np.uint8)
        result[name]={"lo":lo1,"hi":hi1,"lo2":lo2,"hi2":hi2,
                      "color_bgr":d["color_bgr"],"count":d["count"],"select":d.get("select","area")}
        log.info(f"  [{name:8s}] H:[{hl}-{hh}] S:[{sl}-{sh}] V:[{vl}-{vh}]")
    return result


def find_blobs(hsv, m, max_y):
    mask=cv2.inRange(hsv,m["lo"],m["hi"])
    if m["lo2"] is not None: mask=cv2.bitwise_or(mask,cv2.inRange(hsv,m["lo2"],m["hi2"]))
    mask[max_y:,:]=0; mask[:15,:]=0; mask[:,:12]=0; mask[:,-12:]=0
    mask=cv2.morphologyEx(mask,cv2.MORPH_OPEN,_kernel)
    mask=cv2.morphologyEx(mask,cv2.MORPH_CLOSE,_kernel)
    cnts,_=cv2.findContours(mask,cv2.RETR_EXTERNAL,cv2.CHAIN_APPROX_SIMPLE)
    cands=[]
    for c in cnts:
        area=cv2.contourArea(c)
        if area<MIN_BLOB or area>MAX_BLOB: continue
        M=cv2.moments(c)
        if M["m00"]==0: continue
        cx=int(M["m10"]/M["m00"]); cy=int(M["m01"]/M["m00"])
        cands.append((cx,cy,area,int(hsv[cy,cx,1]),max(5,int(math.sqrt(area/math.pi)))))
    cands.sort(key=lambda b:-b[3] if m["select"]=="sat" else -b[2])
    return cands[:m["count"]]


def pick_farthest_pair(blobs):
    best=None; best_d=0
    for i in range(len(blobs)):
        for j in range(i+1,len(blobs)):
            d=math.hypot(blobs[i][0]-blobs[j][0],blobs[i][1]-blobs[j][1])
            if d>best_d: best_d=d; best=(blobs[i],blobs[j])
    return best,best_d


def wheel_hub(ya,yb): return ((ya[0]+yb[0])/2.0,(ya[1]+yb[1])/2.0)

def orange_angle(ora,hub):
    return math.degrees(math.atan2(ora[0]-hub[0],-(ora[1]-hub[1])))%360

def unwrap(prev,curr,cum):
    d=curr-prev
    if d>180: d-=360
    if d<-180: d+=360
    return cum+d

def compute_confidence(has_hub,has_orange,hub_src):
    if has_hub and has_orange: return 100 if hub_src=="YOLO" else 85
    if has_hub: return 60
    if has_orange: return 15
    return 0


# ── Drawing (for output video file only) ──────────────────────────────────

def draw_neon_circle(img,center,radius,color,thickness,glow):
    x,y=int(center[0]),int(center[1])
    if glow:
        gc=tuple(int(c*0.4) for c in color)
        cv2.circle(img,(x,y),radius+5,gc,thickness+2,cv2.LINE_AA)
        cv2.circle(img,(x,y),radius+2,gc,thickness,cv2.LINE_AA)
    cv2.circle(img,(x,y),radius,color,thickness,cv2.LINE_AA)
    cv2.circle(img,(x,y),3,color,-1,cv2.LINE_AA)


def draw_info_bar(bar,W,t_sec,rot_deg,rot_rad,cum_deg,cum_rad,
                  vel_dps,vel_rps,conf,source,info_level,direction,medium):
    GREEN=(0,255,128); WHITE=(230,230,230); GRAY=(120,120,120); YELLOW=(0,220,220)
    def cc(p): return (40,200,40) if p>=80 else ((0,200,220) if p>=50 else (40,40,220))
    c=cc(conf); c1,c2,c3=14,W//3,2*W//3
    cv2.putText(bar,"TIME",(c1,22),cv2.FONT_HERSHEY_SIMPLEX,0.38,GRAY,1)
    cv2.putText(bar,f"{t_sec:.2f} s",(c1,50),cv2.FONT_HERSHEY_SIMPLEX,0.85,WHITE,2,cv2.LINE_AA)
    cv2.putText(bar,"ROTATION",(c1,78),cv2.FONT_HERSHEY_SIMPLEX,0.38,GRAY,1)
    cv2.putText(bar,f"{rot_deg:.1f}" if rot_deg is not None else "---",
                (c1,108),cv2.FONT_HERSHEY_SIMPLEX,0.95,YELLOW,2,cv2.LINE_AA)
    cv2.putText(bar,"deg",(c1+90,108),cv2.FONT_HERSHEY_SIMPLEX,0.50,YELLOW,1)
    cv2.putText(bar,"TOTAL",(c1,150),cv2.FONT_HERSHEY_SIMPLEX,0.38,GRAY,1)
    cv2.putText(bar,f"{cum_deg:+.1f}",(c1,192),cv2.FONT_HERSHEY_SIMPLEX,1.25,GREEN,3,cv2.LINE_AA)
    cv2.putText(bar,"deg",(c1+130,192),cv2.FONT_HERSHEY_SIMPLEX,0.55,GREEN,2)
    if info_level=="full":
        cv2.putText(bar,f"{cum_rad:+.4f} rad",(c1,210),cv2.FONT_HERSHEY_SIMPLEX,0.38,GRAY,1)
        if vel_dps is not None:
            cv2.putText(bar,f"vel: {vel_dps:+.1f} deg/s",(c1,228),cv2.FONT_HERSHEY_SIMPLEX,0.38,GRAY,1)
    cv2.putText(bar,"SIGNIFICANCE",(c2,22),cv2.FONT_HERSHEY_SIMPLEX,0.38,GRAY,1)
    cv2.putText(bar,f"{conf}%",(c2,68),cv2.FONT_HERSHEY_SIMPLEX,1.15,c,2,cv2.LINE_AA)
    bw=c3-c2-20
    cv2.rectangle(bar,(c2,76),(c2+bw,92),(40,40,40),-1)
    fw=int(bw*conf/100)
    if fw>0: cv2.rectangle(bar,(c2,76),(c2+fw,92),c,-1)
    cv2.rectangle(bar,(c2,76),(c2+bw,92),(70,70,70),1)
    def dot(ok,x,y): cv2.circle(bar,(x,y),5,(40,200,40) if ok else (60,60,60),-1)
    dot(source is not None,c2+8,118)
    cv2.putText(bar,"Hub found" if source else "No hub",
                (c2+22,123),cv2.FONT_HERSHEY_SIMPLEX,0.40,WHITE if source else GRAY,1)
    dot(conf>=85,c2+8,146)
    cv2.putText(bar,"Orange found" if conf>=85 else "Orange missing",
                (c2+22,151),cv2.FONT_HERSHEY_SIMPLEX,0.40,WHITE if conf>=85 else GRAY,1)
    if source:
        cv2.putText(bar,f"hub: {source}",(c2,172),cv2.FONT_HERSHEY_SIMPLEX,0.40,(40,200,40),1)
    dcx=c3+(W-c3)//2; dcy=100; dr=68
    cv2.circle(bar,(dcx,dcy),dr,(45,45,45),-1)
    cv2.circle(bar,(dcx,dcy),dr,(80,80,80),1)
    cv2.line(bar,(dcx,dcy-dr),(dcx,dcy-dr+8),(90,90,90),1)
    if rot_deg is not None:
        rad=math.radians(rot_deg)
        cv2.line(bar,(dcx,dcy),
                 (int(dcx+(dr-10)*math.sin(rad)),int(dcy-(dr-10)*math.cos(rad))),c,2,cv2.LINE_AA)
    cv2.circle(bar,(dcx,dcy),4,c,-1)
    cv2.putText(bar,f"{rot_deg:.1f} deg" if rot_deg is not None else "---",
                (dcx-32,dcy+dr+18),cv2.FONT_HERSHEY_SIMPLEX,0.46,c,1,cv2.LINE_AA)
    cv2.putText(bar,"current angle",(dcx-40,dcy+dr+34),cv2.FONT_HERSHEY_SIMPLEX,0.32,GRAY,1)


# ── Main processing function ───────────────────────────────────────────────

def process(video_path: str, out_path: str, job_id: str = "local",
            direction: str = "auto", medium: str = "air",
            info_level: str = "basic",
            progress_cb=None,
            watermark: str = "© enyem.com",
            upload_dt: str = "",
            hand_label: str = "") -> list:
    """
    Process video. progress_cb receives lightweight JSON dict with:
      - detection coordinates (hub, orange)
      - rotation data (angle, cumulative, velocity)
      - video dimensions (for canvas scaling in browser)
    No JPEG frames — browser draws overlay on original video.
    Watermark, upload datetime, hand/medium labels are drawn on video.
    """
    log.info("[DETECT] Building HSV ranges:")
    markers = build_ranges(MARKER_DEFS)
    log.info("[DETECT] Loading ONNX:")
    yolo = load_yolo()
    yolo_active = yolo is not None
    log.info(f"[DETECT] SKIP={SKIP_FRAMES}  YOLO_EVERY={YOLO_EVERY}  "
             f"mode={'ONNX+CV' if yolo_active else 'CV only'}")

    cap = cv2.VideoCapture(video_path)
    if not cap.isOpened():
        raise RuntimeError(f"Cannot open video: {video_path}")

    fps   = cap.get(cv2.CAP_PROP_FPS) or 30.0
    W     = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
    H     = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
    total = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
    total_sec = round(total/fps, 1)

    rot_meta = int(cap.get(97))
    auto_rotate = None
    if rot_meta==90:    auto_rotate=cv2.ROTATE_90_CLOCKWISE
    elif rot_meta==270: auto_rotate=cv2.ROTATE_90_COUNTERCLOCKWISE
    elif rot_meta==180: auto_rotate=cv2.ROTATE_180
    if auto_rotate in (cv2.ROTATE_90_CLOCKWISE, cv2.ROTATE_90_COUNTERCLOCKWISE):
        W, H = H, W

    max_y = int(H*MAX_Y_FRAC)
    log.info(f"[DETECT] {W}x{H} @ {fps:.0f}fps  {total} frames ({total_sec}s)")

    fourcc  = cv2.VideoWriter_fourcc(*"mp4v")
    out_vid = cv2.VideoWriter(out_path, fourcc, fps, (W, H+BAR_HEIGHT))

    stab = Stabilizer()

    rot_prev=None; rot_cum=0.0; rot_buf=[]; zero_offset=None
    vel_dps=0.0; vel_rps=0.0
    hub_buf=[]; hub_stable=None; hub_radius=None; hub_source=None
    gap_hub=0; gap_ora=0; last_hub=None; last_ora=None
    active_color=None; conf_smooth=0.0
    _last_yolo_det={"center":None,"orange":None,"ground":None}

    sample_interval=1.0/SAMPLES_PER_SECOND
    next_sample_at=0.0; all_samples=[]; FLUSH_EVERY=20
    processed_count=0; fi=0

    while True:
        ret, frame = cap.read()
        if not ret: break

        if SKIP_FRAMES>1 and fi%SKIP_FRAMES!=0:
            fi+=1; continue

        if auto_rotate is not None:
            frame=cv2.rotate(frame,auto_rotate)

        t_sec=fi/fps  # real time — physically correct

        frame_stab=stab.stabilize(frame)
        preproc=cv2.bilateralFilter(frame_stab,7,50,50)
        hsv=cv2.cvtColor(preproc,cv2.COLOR_BGR2HSV)

        if hub_stable is not None and hub_radius is not None:
            roi=np.zeros(hsv.shape[:2],np.uint8)
            cv2.circle(roi,(int(hub_stable[0]),int(hub_stable[1])),int(hub_radius*1.15),255,-1)
            hsv_src=cv2.bitwise_and(hsv,hsv,mask=roi)
        else:
            hsv_src=hsv

        if fi%(YOLO_EVERY*max(1,SKIP_FRAMES))==0:
            _last_yolo_det=detect_yolo(yolo,preproc,hsv)
        yolo_det=_last_yolo_det

        # ── Ground mask: ищем orange только внутри bbox колеса ──
        if yolo_det.get("ground") is not None:
            gx, gy, gw, gh = yolo_det["ground"]
            x1 = max(0, gx - gw//2)
            y1 = max(0, gy - gh//2)
            x2 = min(hsv.shape[1]-1, gx + gw//2)
            y2 = min(hsv.shape[0]-1, gy + gh//2)
            ground_roi = np.zeros(hsv.shape[:2], np.uint8)
            ground_roi[y1:y2, x1:x2] = 255
            hsv_src = cv2.bitwise_and(hsv, hsv, mask=ground_roi)

        cv_ora=find_blobs(hsv_src,markers["ORANGE"],max_y)

        if USE_PAIR_FALLBACK:
            cv_yel=find_blobs(hsv_src,markers["YELLOW"],max_y)
            cv_red=find_blobs(hsv_src,markers["RED"],max_y)
        else:
            cv_yel=[]; cv_red=[]

        hub_px_raw=None
        if yolo_det["center"] is not None:
            cx,cy,_,_,_=yolo_det["center"]
            hub_px_raw=(float(cx),float(cy)); hub_source="YOLO"
            gap_hub=0; last_hub=hub_px_raw
        elif USE_PAIR_FALLBACK:
            yp,yd=pick_farthest_pair(cv_yel); rp,rd=pick_farthest_pair(cv_red)
            uy=yp is not None and yd>MIN_PAIR_DIST
            ur=(not uy) and rp is not None and rd>MIN_PAIR_DIST
            if uy:   ap,active_color=yp,"YELLOW"
            elif ur: ap,active_color=rp,"RED"
            else:    ap=None
            if ap is not None:
                b0,b1=ap; hub_px_raw=wheel_hub(b0,b1); hub_source=active_color
                gap_hub=0; last_hub=hub_px_raw
            elif gap_hub<MAX_GAP_FRAMES and last_hub:
                gap_hub+=1; hub_px_raw=last_hub
        elif gap_hub<MAX_GAP_FRAMES and last_hub:
            gap_hub+=1; hub_px_raw=last_hub

        if yolo_det["orange"] is not None:
            ora_blob=yolo_det["orange"]; gap_ora=0; last_ora=ora_blob
        elif cv_ora:
            ora_blob=cv_ora[0]; gap_ora=0; last_ora=ora_blob
        elif gap_ora<MAX_GAP_FRAMES and last_ora:
            gap_ora+=1; ora_blob=last_ora
        else:
            gap_ora=min(gap_ora+1,MAX_GAP_FRAMES+1); ora_blob=None

        has_hub=hub_px_raw is not None; has_orange=ora_blob is not None

        if has_hub:
            hub_buf.append(np.array(hub_px_raw))
            if len(hub_buf)>30: hub_buf.pop(0)
            hub_stable=np.mean(hub_buf,axis=0)
            if yolo_det["center"] is not None:
                _,_,_,_,r=yolo_det["center"]
                hub_radius=max(hub_radius or 0,r*ROI_FACTOR*3)
            if has_orange and hub_stable is not None:
                hub_radius=max(hub_radius or 0,
                               math.hypot(ora_blob[0]-hub_stable[0],
                                          ora_blob[1]-hub_stable[1])*1.3)

        rot_raw=None
        if has_hub and has_orange:
            rot_raw=orange_angle(ora_blob,hub_px_raw)

        if rot_raw is not None and zero_offset is None:
            zero_offset=rot_raw
            log.info(f"[DETECT] Zero t={t_sec:.2f}s: {zero_offset:.1f}deg")

        rot_zeroed=((rot_raw-zero_offset)%360
                    if rot_raw is not None and zero_offset is not None else None)

        if rot_zeroed is not None:
            rot_buf.append(rot_zeroed)
            if len(rot_buf)>SMOOTH_N: rot_buf.pop(0)
            rot_smooth=math.degrees(math.atan2(
                np.mean([math.sin(math.radians(x)) for x in rot_buf]),
                np.mean([math.cos(math.radians(x)) for x in rot_buf])))%360
        else:
            rot_smooth=rot_buf[-1] if rot_buf else None

        if rot_smooth is not None:
            if rot_prev is not None: rot_cum=unwrap(rot_prev,rot_smooth,rot_cum)
            rot_prev=rot_smooth

        if len(rot_buf)>=2 and fps>0:
            d_a=rot_buf[-1]-rot_buf[-2]
            if d_a>180: d_a-=360
            if d_a<-180: d_a+=360
            vel_dps=d_a*fps/SKIP_FRAMES; vel_rps=math.radians(vel_dps)

        conf=compute_confidence(has_hub,has_orange,hub_source or "")
        conf_smooth=conf_smooth*0.6+conf*0.4; conf_disp=int(round(conf_smooth))

        # ── Progress callback — lightweight JSON coords only ───────────────
        if progress_cb is not None:
            pct=int(fi/total*100) if total>0 else 0
            progress_cb({
                # progress
                "frame":           fi,
                "total":           total,
                "pct":             pct,
                "t_sec":           round(t_sec,2),
                "total_sec":       total_sec,
                # video dimensions for canvas scaling
                "vid_w":           W,
                "vid_h":           H,
                # detection coordinates
                "hub":             [round(hub_px_raw[0]),round(hub_px_raw[1])] if hub_px_raw else None,
                "orange":          [ora_blob[0],ora_blob[1],ora_blob[4]] if ora_blob else None,
                "hub_source":      hub_source,
                "ground":          list(yolo_det["ground"]) if yolo_det.get("ground") else None,  # [cx,cy,w,h]
                # rotation data
                "rotation_deg":    round(rot_smooth,1) if rot_smooth is not None else None,
                "cumulative_deg":  round(-rot_cum,1),
                "angular_vel_dps": round(-vel_dps,1),
                "confidence_pct":  conf_disp,
            })

        if t_sec>=next_sample_at:
            all_samples.append(make_sample(
                job_id=job_id,timestamp_sec=t_sec,rotation_deg=rot_smooth,
                cumulative_deg=-rot_cum,angular_vel_dps=-vel_dps,
                confidence_pct=conf_disp,source=hub_source))
            next_sample_at+=sample_interval
            if len(all_samples)%FLUSH_EVERY==0:
                persist_samples(job_id,all_samples[-FLUSH_EVERY:])

        # ── Draw output video ──────────────────────────────────────────────
        ann=frame_stab.copy()
        if hub_px_raw is not None:
            hcol=(40,200,40) if hub_source=="YOLO" else (200,200,40)
            cv2.circle(ann,(int(hub_px_raw[0]),int(hub_px_raw[1])),7,hcol,-1,cv2.LINE_AA)
            cv2.circle(ann,(int(hub_px_raw[0]),int(hub_px_raw[1])),9,(0,0,0),1,cv2.LINE_AA)
        # Draw ground bbox (thin cyan rectangle)
        if yolo_det.get("ground") is not None:
            gx2, gy2, gw2, gh2 = yolo_det["ground"]
            cv2.rectangle(ann,
                (max(0,gx2-gw2//2), max(0,gy2-gh2//2)),
                (min(ann.shape[1]-1,gx2+gw2//2), min(ann.shape[0]-1,gy2+gh2//2)),
                (0, 200, 200), 1)

        if has_orange and ora_blob:
            draw_neon_circle(ann,(ora_blob[0],ora_blob[1]),ora_blob[4]+6,
                             TRACK_CIRCLE_COLOR,TRACK_CIRCLE_THICK,TRACK_CIRCLE_GLOW)
            cv2.putText(ann,"ORA",(ora_blob[0]+ora_blob[4]+8,ora_blob[1]+5),
                        cv2.FONT_HERSHEY_SIMPLEX,0.45,TRACK_CIRCLE_COLOR,1,cv2.LINE_AA)
        if has_hub and has_orange and hub_px_raw:
            cv2.line(ann,(int(hub_px_raw[0]),int(hub_px_raw[1])),
                     (ora_blob[0],ora_blob[1]),TRACK_CIRCLE_COLOR,1,cv2.LINE_AA)

        bar=np.full((BAR_HEIGHT,W,3),(18,18,18),np.uint8)
        cv2.line(bar,(0,0),(W,0),(55,55,55),1)
        draw_info_bar(bar,W,t_sec,rot_smooth,
                      math.radians(rot_smooth) if rot_smooth is not None else None,
                      -rot_cum,math.radians(-rot_cum),
                      -vel_dps,-vel_rps,conf_disp,hub_source,info_level,direction,medium)
        # ── Watermark + labels ────────────────────────────────────────────
        font  = cv2.FONT_HERSHEY_SIMPLEX
        scale = max(0.35, W/1280*0.55)
        thick = 1
        wcolor= (200,200,200); shadow=(0,0,0)
        # Bottom-left: watermark
        if watermark:
            cv2.putText(ann,watermark,(8,H-8),font,scale,shadow,thick+1,cv2.LINE_AA)
            cv2.putText(ann,watermark,(8,H-8),font,scale,wcolor,thick,  cv2.LINE_AA)
        # Top-right: upload datetime
        if upload_dt:
            tw=cv2.getTextSize(upload_dt,font,scale*0.8,thick)[0][0]
            cv2.putText(ann,upload_dt,(W-tw-6,20),font,scale*0.8,shadow,thick+1,cv2.LINE_AA)
            cv2.putText(ann,upload_dt,(W-tw-6,20),font,scale*0.8,wcolor,thick,  cv2.LINE_AA)
        # Top-left: medium + hand
        labels = []
        if medium: labels.append(medium)
        if hand_label: labels.append(hand_label)
        if labels:
            lbl = "  ".join(labels)
            cv2.putText(ann,lbl,(8,20),font,scale*0.8,shadow,thick+1,cv2.LINE_AA)
            cv2.putText(ann,lbl,(8,20),font,scale*0.8,wcolor,thick,  cv2.LINE_AA)

        out_vid.write(np.vstack([ann,bar]))

        if fi%60==0:
            rot_str=f"{rot_smooth:.1f}" if rot_smooth is not None else "---"
            log.info(f"  [{fi:4d}/{total}]  t={t_sec:.1f}s  "
                     f"rot={rot_str}  cum={-rot_cum:.1f}  conf={conf_disp}%")
        fi+=1; processed_count+=1

    remainder=len(all_samples)%FLUSH_EVERY
    if remainder>0: persist_samples(job_id,all_samples[-remainder:])
    cap.release(); out_vid.release()
    log.info(f"[DETECT] Done. {len(all_samples)} samples  →  {out_path}")
    return all_samples