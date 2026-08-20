# FRAMR Automatic Creator Flow

## Product decision

FRAMR should automate visual work. A creator’s job is to make the commercial decision—**which detected object should be replaced, and with which product**—not to trace a mask, manage frames, or operate a technical video tool.

> **The creator chooses the opportunity. FRAMR prepares the placement.**

Manual masking remains important, but only as an exception path for uncertain or difficult shots. It must not be a required step in the primary workflow.

## Immediate defect: target-mask PATCH returns 500

The reported `PATCH /api/placement-targets` failure occurs after the private PNG upload succeeds. The route then updates the target successfully but attempts to insert a seed record into `placement_masks`. Migration `0008_frame_preserving_foundation.sql` enables RLS on `placement_masks` and defines only a **select** policy. It does not define an authenticated **insert** policy. The authenticated server client therefore receives an RLS rejection and the route returns its generic 500 response.

The corrective migration must add owner-scoped insert and update policies for `placement_masks`. The route should also expose a safe request identifier and structured server-side error category so a future policy failure is visible as an actionable message rather than a generic 500.

This bug does not indicate that the uploaded mask PNG failed. The browser log confirms the private Storage upload completed before the PATCH failed.

## The intended creator journey

The revised experience has three creator decisions and one optional recovery action.

| Stage | Creator action | FRAMR automatic work | Screen outcome |
|---|---|---|---|
| Upload | Upload one vertical video | Validate, store immutable source, analyze, create thumbnail, identify candidate objects | Automatically open the video’s Placements workspace. |
| Choose opportunity | Click one detected object | Create target, seed SAM with the detected box, segment and track the object, assess confidence and occlusion | Display a compact selected-object card while tracking begins in background. |
| Choose product | Select an existing campaign/product asset or upload one reference image | Validate product asset and prepare localized edit inputs | Automatically create a protected version run. |
| Preview | No technical action required | Select keyframes, create localized edits, propagate, composite, run QA, render source audio | Automatically navigate to Versions and show a truthful preparation/preview state. |
| Exception only | Click **Refine mask** if asked or desired | Use corrected seed mask to re-track and resume | Return to the same preview flow. |

A creator never has to decide how a mask is stored, which frame is the seed, how tracking works, or whether a worker is running.

## Screen-by-screen experience

### 1. Upload routes directly to the selected video’s Placements page

Immediately after a successful upload, FRAMR routes the creator to:

```text
/workspace?view=placements&video=<video-id>
```

While analysis is running, the page shows the stable placeholder and a concise status: **“Finding product-placement opportunities…”**. It does not show empty editor controls. Once analysis completes, the private thumbnail and detected object cards appear automatically.

### 2. Placements is a decision surface, not a mask editor

The video thumbnail or short muted preview shows detected objects as selectable outlined cards. Each card contains the object label, confidence, visible time range, and a simple commercial suitability signal.

The primary action is one click:

```text
Rice cooker detected  →  Replace this object
```

Selecting the object immediately creates a `PlacementTarget` in `tracking` status. FRAMR starts automatic segmentation and tracking from the existing detection box. A right-side panel asks one non-technical question: **“What product should replace it?”** The creator selects a saved product asset or uploads one image.

The system should permit the creator to select a product while SAM tracking runs. These independent activities happen concurrently and reduce perceived wait time.

### 3. Automatic transition to Versions

When FRAMR has both the selected product and an acceptable target track, it creates the protected placement version and routes the user automatically to:

```text
/workspace?view=versions&video=<video-id>&run=<placement-run-id>
```

The Versions page shows a single truthful card rather than a technical modal:

| Run state | Creator-facing message | Available action |
|---|---|---|
| Preparing target | “Mapping the object through your video.” | Keep browsing; no action required. |
| Preparing preview | “Creating your first placement preview.” | See source and selected product. |
| Review required | “We need a quick mask check for this shot.” | **Refine mask**. |
| Preview ready | “Your placement preview is ready.” | Compare, approve, regenerate, export. |
| Failed | “We could not prepare this placement.” | Retry or choose a different object. |

The page must never say that a final version is ready until localized editing, compositing, QA, and final rendering have actually completed.

### 4. Manual refinement is an advanced recovery action

The brush/erase editor moves behind a small **Refine mask** action. It is shown automatically only when one of the following conditions applies:

| Automatic quality trigger | Default system behavior |
|---|---|
| SAM confidence is below the configured threshold | Ask for a quick mask review. |
| Target leaves the frame or the mask becomes too small | Ask the creator to adjust the time range or choose another object. |
| Significant occlusion is detected | Mark the shot for review rather than creating an unstable preview. |
| More than one visually similar object is plausible | Ask the creator to confirm the selected object. |
| Creator explicitly wants greater control | Open refinement on demand. |

The recovery editor should start with SAM’s generated mask, not an opaque freehand canvas. The creator only corrects the few wrong pixels.

## Revised asynchronous architecture

Target preparation must be separate from product generation. The current `placement_runs` table requires a product and is therefore the wrong vehicle for object tracking that should begin as soon as a creator chooses an opportunity.

The system needs a separate durable target-preparation job.

```text
Creator selects detected object
        ↓
POST /api/placement-targets/auto
        ↓
PlacementTarget(status=tracking)
        ↓
placement_target_jobs: segment_and_track
        ↓
SAM 2.1 or SAM 3 adapter receives detected box prompt
        ↓
private masklets + confidence + occlusion facts
        ↓
PlacementTarget(status=ready | needs_review)
        ↓
Creator chooses product
        ↓
POST /api/placement-runs
        ↓
localized edit → propagation → compositing → QA → render
```

This separation prevents the user from waiting for product selection before FRAMR starts visual work. It also makes retries, cancellation, confidence gating, and target re-tracking independently auditable.

## Required product changes

| Priority | Change | Purpose |
|---|---|---|
| P0 | Add RLS insert/update policies for `placement_masks` and return structured target-save errors. | Fix the immediate 500. |
| P0 | Replace mandatory `MaskRefinementModal` navigation with automatic target creation from a selected placement box. | Remove creator rotoscoping from the primary flow. |
| P0 | Add `placement_target_jobs` with atomic claim, lease, retry, cancellation, realtime status, and a target-only worker command. | Allow automatic SAM work before product selection. |
| P0 | Let SAM use the detected box as its initial visual prompt and write private masklets automatically. | Create the default mask/tracking path. |
| P1 | Add automated target quality thresholds for confidence, frame coverage, mask area, and occlusion. | Decide whether to proceed or request refinement. |
| P1 | Make Versions the automatic post-selection destination with clear run state and no premature preview promise. | Deliver the fast creator experience. |
| P1 | Demote **Refine mask** to an optional recovery control. | Preserve quality without making the product feel manual. |
| P2 | Add advanced target controls for time range, retracking, and frame-by-frame inspection. | Support edge cases without burdening normal creators. |

## Acceptance criteria

The revised primary path is successful when a creator can upload a simple vertical video, select one detected object, select one existing product, and reach a truthful preparing-preview state without drawing a mask or running a terminal command. If automatic tracking is confident, the creator receives a preview with no manual intervention. If it is not confident, FRAMR requests a minimal, clearly explained correction rather than silently producing an unreliable result.

The competitive advantage is not removing all manual controls. It is making **manual work invisible until it is genuinely needed**, while preserving it as the quality-control escape hatch that a less robust competitor will eventually need.
