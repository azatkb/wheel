# Wheel Tracker v3

Detects wheel rotation from video using colored markers.

## Structure

```
wheeltracker/
├── app/
│   ├── config.py          # ALL settings — edit here only
│   ├── database.py        # Supabase + CSV persistence
│   ├── preprocessor.py    # trim/fps/mute (ffmpeg or OpenCV fallback)
│   ├── stabilizer.py      # ECC-based shake removal
│   ├── detector.py        # HSV detection, tracking, overlay
│   ├── main.py            # FastAPI server
│   ├── templates/
│   │   ├── upload.html
│   │   └── stream.html
│   └── __init__.py
├── inputs/   outputs/   csv/   logs/
└── requirements.txt
```

## Install

```bash
pip install -r requirements.txt
pip install onnxruntime-gpu
# Optional but recommended: apt install ffmpeg
```

## Supabase SQL (run once)

```sql
CREATE TABLE wt_jobs (
    id              TEXT        PRIMARY KEY,
    user_email      TEXT,
    source_type     TEXT,
    direction       TEXT,
    medium          TEXT,
    hand_visible    BOOLEAN     DEFAULT FALSE,
    info_level      TEXT        DEFAULT 'basic',
    status          TEXT        DEFAULT 'queued',
    sample_count    INTEGER     DEFAULT 0,
    duration_sec    FLOAT,
    created_at      TIMESTAMPTZ DEFAULT NOW(),
    finished_at     TIMESTAMPTZ
);

CREATE TABLE wt_samples (
    id              BIGSERIAL   PRIMARY KEY,
    job_id          TEXT        NOT NULL,
    timestamp_sec   FLOAT       NOT NULL,
    rotation_deg    FLOAT,
    rotation_rad    FLOAT,
    cumulative_deg  FLOAT       NOT NULL,
    cumulative_rad  FLOAT       NOT NULL,
    angular_vel_dps FLOAT,
    angular_vel_rps FLOAT,
    confidence_pct  INTEGER     NOT NULL,
    source          TEXT,
    created_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX ON wt_samples (job_id);
```

## Configure

Edit `app/config.py`:

```python
SUPABASE_URL       = "https://YOUR.supabase.co"
SUPABASE_KEY       = "YOUR_KEY"
SAMPLES_PER_SECOND = 4          # min 4, up to OUTPUT_FPS
OUTPUT_FPS         = 60
MAX_DURATION_SEC   = 120        # 2 minutes
STABILIZE          = True       # ECC shake removal
```

Or environment variables: `SUPABASE_URL`, `SUPABASE_KEY`

## Run

```bash
uvicorn app.main:app --host 0.0.0.0 --port 8000
```

HTTPS (for phone camera):
```bash
# Option 1 — ngrok (easiest)
ngrok http 8000

# Option 2 — self-signed cert
openssl req -x509 -newkey rsa:4096 -keyout key.pem -out cert.pem -days 365 -nodes -subj "/CN=localhost"
uvicorn app.main:app --host 0.0.0.0 --port 8000 --ssl-keyfile key.pem --ssl-certfile cert.pem
```

## API

| Method | URL | Description |
|--------|-----|-------------|
| POST | /upload | Upload video + params |
| GET | /status/{id} | Poll: queued/preprocessing/processing/done/error |
| GET | /download/{id} | Download annotated video |
| GET | /results/{id} | All samples as JSON |
| GET | /csv/{id} | Download CSV (semicolon separator) |
| WS | /stream | Real-time: send JPEG, receive JSON |
| GET | /health | Server status |

## CSV columns

```
job_id ; timestamp_sec ; rotation_deg ; rotation_rad ;
cumulative_deg ; cumulative_rad ;
angular_vel_dps ; angular_vel_rps ;
confidence_pct ; source
```

## WebSocket JSON per frame

```json
{
  "frame": 42,
  "rotation_deg": 17.3,
  "rotation_rad": 0.30196,
  "cumulative_deg": +14.7,
  "cumulative_rad": +0.25655,
  "angular_vel_dps": -2.1,
  "angular_vel_rps": -0.03665,
  "confidence_pct": 100,
  "hub_px": [427, 223],
  "scale_mm_px": 0.12121,
  "source": "YELLOW"
}
```

## Significance levels

| Detected | % |
|---|---|
| 2x yellow + orange | **100%** |
| 2x yellow only | 70% |
| 1x yellow + orange | 30% |
| nothing | 0% |
