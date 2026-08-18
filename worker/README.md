# FRAMR analysis worker

The analysis worker claims uploaded videos in the `processing` state, downloads the private source object, validates the real media stream with FFprobe, writes a JPEG thumbnail with FFmpeg, detects placement candidates, and persists scenes, objects, placements, and per-frame tracks. The public `videos.status` remains `processing` during work, then changes to `ready` or `failed`; the workspace's existing Realtime subscription receives that update.

## Modes

| Mode | Command | Purpose |
|---|---|---|
| Deterministic mock | `FRAMR_ANALYSIS=mock python -m framr_worker.cli --once` | Runs the full storage and database workflow with stable placement results. It is the default for development and demos. |
| Live detection | `FRAMR_ANALYSIS=live python -m framr_worker.cli --once` | Runs Ultralytics YOLO tracking with ByteTrack. It downloads model weights if they are not already cached. |
| Continuous worker | `python -m framr_worker.cli` | Claims queued videos continually, sleeping for `FRAMR_POLL_SECONDS` only when no job is available. |

## Safety and queue behavior

Migration `0004_analysis_worker.sql` adds lifecycle metadata and the `claim_next_video_for_analysis()` function. It uses a database row lock and stale-claim recovery so multiple worker processes do not process the same upload concurrently. The worker must use a Supabase **service-role key**, which bypasses row-level security for trusted worker writes; never put it in browser code or `web/.env.local`.

The worker validates the downloaded byte stream—not client-submitted metadata—against the current upload constraints: H.264 or VP8 video, 9:16 aspect ratio, 15–60 seconds, and at most 500 MB. It writes only a sanitized error string to the database and keeps detailed failures in process logs.

## Environment and setup

Copy `.env.example` into the environment that runs the worker. Apply Supabase migrations through `0004_analysis_worker.sql` before starting it. FFmpeg and FFprobe must be available on the host `PATH` (or configured via `FRAMR_FFMPEG_BIN` and `FRAMR_FFPROBE_BIN`).

```bash
cd worker
python3 -m venv .venv
. .venv/bin/activate
pip install -r requirements.txt
export SUPABASE_URL=https://<project>.supabase.co
export SUPABASE_SERVICE_ROLE_KEY=<service-role-key>
FRAMR_ANALYSIS=mock python -m framr_worker.cli --once
```

## Live tracking

Set `FRAMR_ANALYSIS=live` to use Ultralytics `model.track(..., persist=True, tracker="bytetrack.yaml")`. Tracks that remain visible for at least two seconds become placement candidates, with normalized boxes and sampled frame coordinates written to `placement_tracks`. The default `yolo11n.pt` model is intentionally configurable through `FRAMR_YOLO_MODEL`, since an eventual product-specific model can replace it without changing the worker contract.

## Deployment boundary

A production worker needs an always-on host with Python, FFmpeg/FFprobe, and computer-vision dependencies. It is intentionally not auto-started by local Next.js development. The implementation is ready to run once the migration, service-role secret, runtime dependencies, and persistent host are in place.
