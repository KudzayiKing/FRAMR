# FRAMR Frame-Preserving Foundation — Physical Test Handoff

## Purpose

This change set replaces the **new-work** Lucy queue path with a protected, staged placement-run foundation. It is intentionally not a visual replacement engine yet. The current worker writes a private source/target manifest, then safely stops at the first missing segmentation boundary with `needs_review`. It must never call Decart Lucy, any paid image API, or fabricate an edited video.

> **Do not run any legacy Decart generation worker for a new protected run.** The new frame worker is a separate Python command.

## Before testing

Apply `supabase/migrations/0008_frame_preserving_foundation.sql` manually in the Supabase SQL Editor. The migration is additive: it creates private `artifacts` storage, protected run/target/mask/keyframe/quality tables, stage-claim logic, and the new realtime publications. It does not delete source videos or historical versions.

Restart the local web server after applying the migration:

```bash
cd /Users/kudzayi/Developer/FRAMR/web
npm run dev
```

Keep the existing `worker/.env` unchanged. It must stay mode `600` and retain the service-role key only in the worker environment.

## Controlled test procedure

| Step | Action | Expected result |
|---|---|---|
| 1 | Open the creator workspace and select **Placements**. | Existing detected objects appear as selectable target boxes and rows. |
| 2 | Click a specific detected object—not the generic header action. | The **Frame-preserving placement** modal opens and names the selected object/time range. |
| 3 | Select one existing private product reference and click **Create protected run**. | The app creates one `placement_runs` record, one draft version, one target, and nine ordered stage rows. A repeated click for the same placement/product returns the active run rather than a duplicate. |
| 4 | In a second terminal, run the worker once. | The worker completes `prepare_source`, writes a JSON manifest in private `artifacts/<owner>/<run>/manifests/`, and advances the run to `segment_target`. |
| 5 | Run the worker once again. | The development segmentation adapter stops safely as `needs_review`; it must not create a generated MP4 and must not call Decart. The modal displays the review message. |
| 6 | Refresh the workspace. | The selected run’s state remains persisted; no stale queued status or duplicate version should appear. |
| 7 | Create another protected run, then choose **Cancel this run** before starting the worker. | The run and all queued stage rows become `canceled`; its draft version is not activatable. |

Run the frame worker using:

```bash
cd /Users/kudzayi/Developer/FRAMR/worker
set -a; source .env; set +a
.venv/bin/python -m framr_worker.frame_cli --once
```

For physical testing, invoke `--once` twice as described above. Do not start it continuously until a durable worker host and verified providers are available.

## Database queries for verification

Use these read-only queries in Supabase SQL Editor after the test. Replace no values; they show newest data first.

```sql
select id, status, current_stage, progress, error, created_at, finished_at
from public.placement_runs
order by created_at desc
limit 10;
```

```sql
select run_id, sequence, job_type, status, attempt, output_manifest_key, error
from public.placement_job_steps
order by created_at desc, sequence asc
limit 30;
```

```sql
select placement_run_id, status, review_status, video_key, thumbnail_key
from public.placement_versions
where placement_run_id is not null
order by created_at desc
limit 10;
```

## Pass conditions

The foundation is ready for the next research milestone only if the run is idempotent, source media remains immutable, artifact keys stay in owner-scoped private storage, the first stage recovers correctly after a worker restart, and an unavailable provider causes `needs_review` rather than a fake success or a whole-video fallback.

## Deliberately deferred

A real SAM-family segmentation provider, manual mask brush/refinement UI, adaptive keyframe extraction, FLUX.2 localized crop editing, temporal propagation, deterministic compositing, quality metrics, generated MP4 output, and durable GPU deployment are all deliberately deferred. They require verified provider/API decisions and a GPU execution route.

## Manual mask and SAM 2.1 research path

After the base migration is applied, the current Apple-silicon development machine can run the official local **SAM 2.1 tiny** checkpoint without a paid API. Before creating a test run, set the provider identically in the local web and worker environments, then restart the web server.

```bash
# web/.env.local — no provider key belongs here
FRAMR_SEGMENTATION_PROVIDER=sam2
FRAMR_SEGMENTATION_MODEL=sam2.1-hiera-tiny
```

```bash
# worker/.env — service-role key remains worker-only
FRAMR_SEGMENTATION_PROVIDER=sam2
FRAMR_SAM2_CHECKPOINT=/Users/kudzayi/Developer/FRAMR/worker/models/sam2.1_hiera_tiny.pt
FRAMR_SAM2_DEVICE=mps
```

The official checkpoint is stored under `worker/models/` and is ignored by Git. The installed official SAM 2 package is pinned in `worker/requirements.txt`.

Use the normal **Placements** page to click a specific detected object. The new manual review modal opens the source video at the placement time when a signed source URL is available. Paint or erase the translucent seed region, then choose **Save refined target**. This uploads an owner-scoped private PNG under `artifacts/<owner>/targets/<target>/masks/` and records a new target revision. No source video pixels change.

Start the protected run with a product reference, then invoke the worker with `--once` repeatedly. The expected stage progression is shown below.

| Worker invocation | Expected durable state | External model activity |
|---|---|---|
| 1 | `prepare_source` completes | None. A private immutable-source manifest is written. |
| 2 | `segment_target` completes | SAM 2.1 creates private PNG masklets only. |
| 3 | `track_target` completes | None; it verifies the persisted SAM masklet set. |
| 4 | `select_keyframes` completes | None; OpenCV extracts local source-frame, crop, and crop-mask artifacts for seed and temporally distributed visible frames. |
| 5 | `edit_keyframes` becomes `needs_review` | None. A private localized-edit request manifest is written, containing only crop/mask/product-reference keys. |

The fifth result is the intended safe stopping point. FRAMR has prepared localized keyframe edits but will not alter any crop until a verified masked image-edit provider is configured. It will never send the full source video to that provider.

SAM 3 is also represented as a selectable safety gate, but it cannot run on this Apple M3 machine. Meta’s official SAM 3 path requires a CUDA-compatible GPU and gated checkpoint access. Selecting `sam3` here produces a review-required status and never falls back to a different model.

## Automatic placement preparation

Apply `supabase/migrations/0009_automatic_target_preparation.sql` **after** migration `0008`. Migration `0009` corrects the authenticated `placement_masks` insert/update policy that caused the earlier `PATCH /api/placement-targets` 500. It also creates the durable `placement_target_jobs` queue used before product selection.

The normal creator test no longer starts with the mask canvas:

1. Upload a valid portrait video and let the normal analysis worker make it `ready`.
2. Open **Placements**. Click one detected object only.
3. FRAMR should route to **Versions** and show **Mapping the selected object**. This creates a target from the detected bounding box and queues `segment_and_track` automatically.
4. Run the existing frame worker. It now claims automatic target jobs before full placement-run stages:

```bash
cd /Users/kudzayi/Developer/FRAMR/worker
set -a; source .env; set +a
FRAMR_SEGMENTATION_PROVIDER=sam2 \
FRAMR_SAM2_CHECKPOINT=/Users/kudzayi/Developer/FRAMR/worker/models/sam2.1_hiera_tiny.pt \
FRAMR_SAM2_DEVICE=mps \
.venv/bin/python -m framr_worker.frame_cli --once
```

5. Refresh the workspace after the worker completes. The target should become **ready** and the Versions modal unlocks product selection without any mask drawing.
6. Select a product and create the protected run. The existing localized keyframe workflow then continues from the already prepared SAM masklets.

Use **Refine mask** only when automatic tracking returns `needs_review` or when the creator deliberately wants to correct the track. Saving a correction now restarts automatic target tracking; it is no longer the primary entry point.

> Development note: the `--once` command is intentionally deterministic for physical testing. A deployed FRAMR environment must run the same worker continuously so target tracking begins automatically after object selection, without the creator opening a terminal.
