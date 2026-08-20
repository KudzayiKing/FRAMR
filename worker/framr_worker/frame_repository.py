from __future__ import annotations

from datetime import UTC, datetime
from typing import Any

from .frame_types import FRAME_STAGES, PlacementRunContext, PlacementStageJob, StageOutcome


class FrameRunRepository:
    def __init__(self, client: Any, *, worker_id: str, lease_seconds: int) -> None:
        self.client = client
        self.worker_id = worker_id
        self.lease_seconds = lease_seconds

    def claim_next(self) -> PlacementStageJob | None:
        response = self.client.rpc(
            "claim_next_placement_job",
            {"p_worker_id": self.worker_id, "p_lease_seconds": self.lease_seconds},
        ).execute()
        rows = response.data or []
        return PlacementStageJob.from_row(rows[0]) if rows else None

    def load_context(self, job: PlacementStageJob) -> PlacementRunContext:
        video_response = self.client.table("videos").select(
            "storage_key,duration_seconds,frame_rate,frame_count"
        ).eq("id", job.source_video_id).single().execute()
        video = video_response.data
        if not video or not video.get("storage_key"):
            raise RuntimeError("The immutable source video is unavailable.")

        target = None
        if job.target_id:
            target_response = self.client.table("placement_targets").select(
                "start_frame,end_frame,seed_frame,seed_bbox,seed_mask_key,manual_revision"
            ).eq("id", job.target_id).single().execute()
            target = target_response.data
        if not target:
            raise RuntimeError("The approved placement target is unavailable.")

        references_response = self.client.table("product_references").select(
            "storage_key"
        ).eq("product_id", job.product_id).order("sort_order").execute()
        references = [str(row["storage_key"]) for row in (references_response.data or []) if row.get("storage_key")]
        if not references:
            product_response = self.client.table("products").select("image_key").eq("id", job.product_id).single().execute()
            image_key = (product_response.data or {}).get("image_key")
            if image_key:
                references = [str(image_key)]
        if not references:
            raise RuntimeError("The placement product has no private reference image.")

        frame_rate = float(video.get("frame_rate") or 30.0)
        duration = float(video.get("duration_seconds") or 0.0)
        frame_count = int(video.get("frame_count") or max(1, round(duration * frame_rate)))
        return PlacementRunContext(
            storage_key=str(video["storage_key"]),
            duration_seconds=duration,
            frame_rate=frame_rate,
            frame_count=frame_count,
            target_start_frame=int(target["start_frame"]),
            target_end_frame=int(target["end_frame"]),
            target_seed_frame=int(target["seed_frame"]),
            target_seed_bbox=target.get("seed_bbox") if isinstance(target.get("seed_bbox"), dict) else None,
            target_seed_mask_key=target.get("seed_mask_key"),
            target_revision=int(target.get("manual_revision") or 0),
            product_reference_keys=tuple(references),
        )

    def list_masklets(self, job: PlacementStageJob, *, revision: int) -> list[dict[str, Any]]:
        if not job.target_id:
            raise RuntimeError("A tracked masklet requires a placement target.")
        response = self.client.table("placement_masks").select(
            "frame_index,storage_key,confidence,is_occluded,revision"
        ).eq("target_id", job.target_id).eq("kind", "target").eq("revision", revision).order("frame_index").execute()
        return response.data or []

    def record_keyframe(
        self,
        job: PlacementStageJob,
        *,
        frame_index: int,
        time_seconds: float,
        reason: str,
        source_frame_key: str,
        crop_key: str,
        mask_key: str,
        score: float | None,
    ) -> None:
        self.client.table("placement_keyframes").upsert(
            {
                "run_id": job.run_id,
                "target_id": job.target_id,
                "owner_id": job.owner_id,
                "frame_index": frame_index,
                "reason": reason,
                "importance_score": score,
                "source_crop_key": crop_key,
                "mask_key": mask_key,
                "status": "pending",
                "provider": job.image_editor_provider,
                "model": job.image_editor_model,
                "settings": {"source_frame_key": source_frame_key, "time_seconds": time_seconds},
            },
            on_conflict="run_id,frame_index"
        ).execute()

    def record_generated_keyframe(
        self,
        job: PlacementStageJob,
        *,
        frame_index: int,
        generated_crop_key: str,
        provider: str,
        model: str,
    ) -> None:
        response = self.client.table("placement_keyframes").update(
            {
                "generated_crop_key": generated_crop_key,
                "status": "ready",
                "provider": provider,
                "model": model,
            }
        ).eq("run_id", job.run_id).eq("frame_index", frame_index).execute()
        if getattr(response, "error", None):
            raise RuntimeError("Could not persist the localized FLUX keyframe.")

    def list_keyframes(self, job: PlacementStageJob) -> list[dict[str, Any]]:
        response = self.client.table("placement_keyframes").select(
            "frame_index,reason,importance_score,source_crop_key,mask_key,generated_crop_key,status,provider,model,settings"
        ).eq("run_id", job.run_id).in_("status", ["pending", "editing", "ready"]).order("frame_index").execute()
        return response.data or []

    def record_masklet(
        self,
        job: PlacementStageJob,
        *,
        frame_index: int,
        storage_key: str,
        revision: int,
        confidence: float | None = None,
        is_occluded: bool = False,
    ) -> None:
        if not job.target_id:
            raise RuntimeError("A tracked masklet requires a placement target.")
        self.client.table("placement_masks").upsert(
            {
                "target_id": job.target_id,
                "owner_id": job.owner_id,
                "frame_index": frame_index,
                "kind": "target",
                "storage_key": storage_key,
                "confidence": confidence,
                "is_occluded": is_occluded,
                "revision": revision,
            },
            on_conflict="target_id,frame_index,kind,revision"
        ).execute()

    def complete_stage(self, job: PlacementStageJob, outcome: StageOutcome) -> None:
        now = datetime.now(UTC).isoformat()
        next_stage = FRAME_STAGES[job.sequence + 1] if job.sequence + 1 < len(FRAME_STAGES) else None
        run_status = "ready" if next_stage is None else "running"
        run_values: dict[str, Any] = {
            "status": run_status,
            "progress": outcome.progress,
            "current_stage": next_stage or "render_video",
        }
        if next_stage is None:
            run_values["finished_at"] = now
        step_update = self.client.table("placement_job_steps").update(
            {
                "status": "complete",
                "progress": 100,
                "output_manifest_key": outcome.output_manifest_key,
                "metrics": outcome.metrics,
                "lease_expires_at": None,
                "completed_at": now,
                "error": None,
            }
        ).eq("id", job.id).execute()
        if getattr(step_update, "error", None):
            raise RuntimeError("Could not complete the frame-preserving stage.")
        run_update = self.client.table("placement_runs").update(run_values).eq("id", job.run_id).execute()
        if getattr(run_update, "error", None):
            raise RuntimeError("Could not advance the frame-preserving run.")

    def publish_version(self, job: PlacementStageJob, *, video_key: str, thumbnail_key: str) -> None:
        response = self.client.table("placement_versions").update(
            {
                "status": "ready",
                "review_status": "approved",
                "video_key": video_key,
                "thumbnail_key": thumbnail_key,
            }
        ).eq("placement_run_id", job.run_id).execute()
        if getattr(response, "error", None):
            raise RuntimeError("Could not publish the placement preview.")

    def block_for_review(self, job: PlacementStageJob, message: str, *, manifest_key: str | None = None) -> None:
        now = datetime.now(UTC).isoformat()
        self.client.table("placement_job_steps").update(
            {
                "status": "blocked",
                "error": message[:500],
                "output_manifest_key": manifest_key,
                "lease_expires_at": None,
                "completed_at": now,
            }
        ).eq("id", job.id).execute()
        self.client.table("placement_runs").update(
            {
                "status": "needs_review",
                "error": message[:500],
                "progress": min(99, (job.sequence / len(FRAME_STAGES)) * 100),
                "finished_at": now,
            }
        ).eq("id", job.run_id).execute()
        self.client.table("placement_versions").update(
            {"status": "failed", "review_status": "needs_review"}
        ).eq("placement_run_id", job.run_id).execute()
        if job.target_id:
            self.client.table("placement_targets").update({"status": "needs_review"}).eq("id", job.target_id).execute()

    def fail_stage(self, job: PlacementStageJob, message: str) -> None:
        now = datetime.now(UTC).isoformat()
        self.client.table("placement_job_steps").update(
            {
                "status": "failed",
                "error": message[:500],
                "lease_expires_at": None,
                "completed_at": now,
            }
        ).eq("id", job.id).execute()
        self.client.table("placement_runs").update(
            {"status": "failed", "error": message[:500], "finished_at": now}
        ).eq("id", job.run_id).execute()
        self.client.table("placement_versions").update(
            {"status": "failed", "review_status": "needs_review"}
        ).eq("placement_run_id", job.run_id).execute()
