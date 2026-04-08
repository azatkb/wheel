"""
preprocessor.py
===============
Video preprocessing before detection:
  1. Trim to MAX_DURATION_SEC (2 minutes)
  2. Convert to OUTPUT_FPS (60 fps)
  3. Mute (remove audio)
  4. Fix phone rotation metadata

Uses ffmpeg if available, falls back to pure OpenCV automatically.
"""

import subprocess
import logging
from pathlib import Path
import cv2

from app.config import OUTPUT_FPS, MAX_DURATION_SEC

log = logging.getLogger(__name__)


def _ffmpeg_ok() -> bool:
    try:
        r = subprocess.run(["ffmpeg", "-version"], capture_output=True, timeout=5)
        return r.returncode == 0
    except (FileNotFoundError, subprocess.TimeoutExpired):
        return False


def preprocess_video(src: Path, dst: Path) -> dict:
    """
    Preprocess video. Picks ffmpeg or OpenCV automatically.
    Returns info dict.
    """
    if _ffmpeg_ok():
        return _ffmpeg(src, dst)
    log.warning("[PREP] ffmpeg not found — using OpenCV fallback")
    return _opencv(src, dst)


def _ffmpeg(src: Path, dst: Path) -> dict:
    log.info(f"[PREP/ffmpeg] {src.name} → {dst.name}")
    cmd = [
        "ffmpeg", "-y",
        "-i",  str(src),
        "-t",  str(MAX_DURATION_SEC),
        "-r",  str(OUTPUT_FPS),
        "-vf", f"fps={OUTPUT_FPS}",
        "-an",                         # no audio
        "-c:v", "libx264",
        "-preset", "fast", "-crf", "23",
        str(dst),
    ]
    r = subprocess.run(cmd, capture_output=True, text=True, timeout=300)
    if r.returncode != 0:
        raise RuntimeError(f"ffmpeg failed:\n{r.stderr[-800:]}")
    size = dst.stat().st_size / 1_048_576
    log.info(f"[PREP/ffmpeg] done {size:.1f} MB")
    return {"method": "ffmpeg", "fps": OUTPUT_FPS, "size_mb": round(size, 2)}


def _opencv(src: Path, dst: Path) -> dict:
    log.info(f"[PREP/opencv] {src.name} → {dst.name}")
    cap = cv2.VideoCapture(str(src))
    if not cap.isOpened():
        raise RuntimeError(f"Cannot open {src}")

    src_fps = cap.get(cv2.CAP_PROP_FPS) or 30.0
    W       = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
    H       = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
    total   = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))

    # Handle phone rotation metadata
    rot_meta   = int(cap.get(97))
    auto_rotate = None
    if rot_meta == 90:    auto_rotate = cv2.ROTATE_90_CLOCKWISE
    elif rot_meta == 270: auto_rotate = cv2.ROTATE_90_COUNTERCLOCKWISE
    elif rot_meta == 180: auto_rotate = cv2.ROTATE_180
    if auto_rotate in (cv2.ROTATE_90_CLOCKWISE, cv2.ROTATE_90_COUNTERCLOCKWISE):
        W, H = H, W

    writer = cv2.VideoWriter(str(dst), cv2.VideoWriter_fourcc(*"mp4v"),
                             OUTPUT_FPS, (W, H))
    ratio         = src_fps / OUTPUT_FPS
    max_src       = int(MAX_DURATION_SEC * src_fps)
    out_idx = written = 0

    while True:
        src_idx = int(out_idx * ratio)
        if src_idx >= min(max_src, total): break
        if out_idx / OUTPUT_FPS >= MAX_DURATION_SEC: break
        cap.set(cv2.CAP_PROP_POS_FRAMES, src_idx)
        ret, frame = cap.read()
        if not ret: break
        if auto_rotate is not None:
            frame = cv2.rotate(frame, auto_rotate)
        writer.write(frame)
        written += 1; out_idx += 1

    cap.release(); writer.release()
    size = dst.stat().st_size / 1_048_576
    log.info(f"[PREP/opencv] done  {written} frames  {size:.1f} MB")
    return {"method": "opencv", "fps": OUTPUT_FPS,
            "frames": written, "size_mb": round(size, 2)}


def get_video_info(path: Path) -> dict:
    try:
        cap = cv2.VideoCapture(str(path))
        fps = cap.get(cv2.CAP_PROP_FPS)
        info = {
            "width":    int(cap.get(cv2.CAP_PROP_FRAME_WIDTH)),
            "height":   int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT)),
            "fps":      round(fps, 2),
            "frames":   int(cap.get(cv2.CAP_PROP_FRAME_COUNT)),
            "duration": round(int(cap.get(cv2.CAP_PROP_FRAME_COUNT)) / max(fps, 1), 2),
            "rotate":   int(cap.get(97)),
        }
        cap.release()
        return info
    except Exception as e:
        log.warning(f"[PREP] get_video_info: {e}")
        return {}
