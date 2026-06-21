"""
config.py
=========
Central configuration — change everything here, touch nothing else.
"""
import os
from pathlib import Path
from dotenv import load_dotenv

load_dotenv(Path(__file__).parent.parent / ".env") 

# ── Directories ────────────────────────────────────────────────────────────
BASE_DIR    = Path(__file__).parent.parent
INPUTS_DIR  = BASE_DIR / "inputs"
OUTPUTS_DIR = BASE_DIR / "outputs"
CSV_DIR     = BASE_DIR / "csv"
LOGS_DIR    = BASE_DIR / "logs"
for d in (INPUTS_DIR, OUTPUTS_DIR, CSV_DIR, LOGS_DIR):
    d.mkdir(exist_ok=True)

# ── Video preprocessing ────────────────────────────────────────────────────
OUTPUT_FPS       = 60       # convert every input video to this frame rate
MAX_DURATION_SEC = 10#120      # clip videos longer than 2 minutes
MUTE_AUDIO       = True     # always strip audio from output
PREPROCESS_ENABLED = False     # enable/disable video preprocessing (trim, fps, mute)

# ── Sampling ───────────────────────────────────────────────────────────────
# Number of data samples recorded per second.
# Minimum 4 (= one sample every 250 ms).
# Can be raised up to OUTPUT_FPS.
SAMPLES_PER_SECOND = 4

# ── Detection ──────────────────────────────────────────────────────────────
MAX_Y_FRAC        = 0.90    # ignore bottom 10% of frame (table edge, floor)
MIN_BLOB          = 40      # minimum blob area in pixels²
MAX_BLOB          = 9000    # maximum blob area in pixels²
MIN_PAIR_DIST     = 50      # minimum pixel distance for a valid opposite pair
MAX_GAP_FRAMES    = 5       # gap-fill: keep last position for this many frames
ROI_FACTOR        = 1.9     # ROI radius = this × half yellow-pair distance
SMOOTH_N          = 4       # circular-mean smoothing window (frames)

# ── Stabilization ──────────────────────────────────────────────────────────
# ECC-based stabilization removes camera shake before detection.
STABILIZE         = False    # enable/disable stabilization
STAB_MAX_ITER     = 50      # ECC iterations (more = slower but smoother)
STAB_EPSILON      = 1e-4    # ECC convergence threshold
STAB_BUFFER       = 30      # number of frames used to compute stable reference

# ── Wheel geometry ─────────────────────────────────────────────────────────
WHEEL_DIAMETER_MM = 70.0
WHEEL_RADIUS_MM   = 35.0

# ── Visualization ──────────────────────────────────────────────────────────
BAR_HEIGHT         = 260    # info bar height (px) below video frame
# Neon green tracking circle around orange dot
TRACK_CIRCLE_COLOR = (0, 255, 128)   # BGR  — neon green
TRACK_CIRCLE_THICK = 3
TRACK_CIRCLE_GLOW  = True            # draw a second slightly larger dim circle

# ── Supabase ───────────────────────────────────────────────────────────────
SUPABASE_URL   = os.getenv("SUPABASE_URL",   "https://eslyzmgvffoldhocjfvc.supabase.co")
SUPABASE_KEY   = os.getenv("SUPABASE_KEY",   "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImVzbHl6bWd2ZmZvbGRob2NqZnZjIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3NzM1NjQwMSwiZXhwIjoyMDkyOTMyNDAxfQ.NZIFVmFwld93rpFpw2TOTqatU0xPH-S_sRUYgjRBcvI")
TABLE_JOBS     = "wt_jobs"      # one row per uploaded video / session
TABLE_SAMPLES  = "wt_samples"   # one row per data sample

# ── CSV ────────────────────────────────────────────────────────────────────
CSV_SEPARATOR = ";"

# ── Job defaults (overridden by form submission) ───────────────────────────
DETECT_OTHER_COLORS = False        # detect red/yellow/green markers on spoke tips
DRAW_MESH_OVERLAY   = True        # draw spoke mesh shape overlay on output video

DEFAULT_DIRECTION   = "auto"      # "cw" | "ccw" | "cw+ccw" | "ccw+cw" | "auto"
DEFAULT_MEDIUM      = "air"       # "air" | "water"
DEFAULT_HAND        = False       # True = hand visible in frame
DEFAULT_INFO_LEVEL  = "basic"     # "basic" | "full"