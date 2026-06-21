"""
stabilizer.py
=============
Video stabilization using OpenCV ECC (Enhanced Correlation Coefficient).

How it works:
  1. Collect a buffer of the first N frames to compute a "reference" (mean frame).
  2. For every incoming frame, find the affine warp that best aligns it
     to the reference using ECC minimization.
  3. Apply the inverse warp to cancel out camera shake.

This handles both small jitter AND heavy handheld shake.
"""

import cv2
import numpy as np
import logging

from app.config import STAB_BUFFER, STAB_MAX_ITER, STAB_EPSILON, STABILIZE

log = logging.getLogger(__name__)


class Stabilizer:
    """
    Frame-by-frame video stabilizer.

    Usage:
        stab = Stabilizer()
        for frame in frames:
            stable_frame = stab.stabilize(frame)
    """

    def __init__(self):
        # Internal buffer of grayscale frames used to build the reference
        self._buffer     = []
        # Reference frame (gray) — the "ideal still" we align everything to
        self._reference  = None
        # ECC warp mode: MOTION_EUCLIDEAN = translation + rotation (no scale)
        # Use MOTION_AFFINE for more complex distortions
        self._warp_mode  = cv2.MOTION_EUCLIDEAN
        # Initial warp matrix (identity = no transform)
        self._warp_init  = np.eye(2, 3, dtype=np.float32)
        # ECC termination criteria
        self._criteria   = (
            cv2.TERM_CRITERIA_EPS | cv2.TERM_CRITERIA_COUNT,
            STAB_MAX_ITER,
            STAB_EPSILON,
        )
        self._enabled    = STABILIZE
        log.info(f"[STAB] Stabilizer ready  enabled={self._enabled}  "
                 f"buffer={STAB_BUFFER}  iter={STAB_MAX_ITER}")

    def _to_gray(self, frame: np.ndarray) -> np.ndarray:
        """Convert BGR frame to grayscale for ECC alignment."""
        return cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)

    def _build_reference(self) -> None:
        """
        Average the buffered frames to create a stable reference image.
        Averaging reduces noise and produces a cleaner alignment target.
        """
        stack = np.stack(self._buffer, axis=0).astype(np.float32)
        self._reference = np.mean(stack, axis=0).astype(np.uint8)
        log.info("[STAB] Reference frame built from "
                 f"{len(self._buffer)} frames")

    def stabilize(self, frame: np.ndarray) -> np.ndarray:
        """
        Stabilize one frame.
        Returns the warped (stabilized) frame, same size as input.
        If stabilization is disabled or not yet warmed up, returns frame as-is.
        """
        if not self._enabled:
            return frame

        h, w = frame.shape[:2]
        gray = self._to_gray(frame)

        # ── Phase 1: fill the warm-up buffer ──────────────────────────────
        if self._reference is None:
            self._buffer.append(gray)
            if len(self._buffer) >= STAB_BUFFER:
                self._build_reference()
            # Return frame unchanged during warm-up
            return frame

        # ── Phase 2: ECC alignment to reference ───────────────────────────
        try:
            warp_matrix = self._warp_init.copy()
            _, warp_matrix = cv2.findTransformECC(
                self._reference,    # template (what we want to look like)
                gray,               # input (current shaky frame)
                warp_matrix,
                self._warp_mode,
                self._criteria,
                None,               # no input mask
                5,                  # gaussFiltSize: pre-blur reduces noise
            )

            # Apply the warp to correct the frame
            stabilized = cv2.warpAffine(
                frame,
                warp_matrix,
                (w, h),
                flags=cv2.INTER_LINEAR | cv2.WARP_INVERSE_MAP,
                borderMode=cv2.BORDER_REPLICATE,  # fill edges with edge pixels
            )
            return stabilized

        except cv2.error as e:
            # ECC can fail on very blurry or featureless frames
            # Fall back to returning the original frame
            log.debug(f"[STAB] ECC failed (returning original): {e}")
            return frame

    def reset(self) -> None:
        """Reset stabilizer state (call when starting a new video)."""
        self._buffer    = []
        self._reference = None
        log.info("[STAB] Reset")
