from __future__ import annotations

from datetime import UTC, datetime
from typing import Any

from .target_types import PlacementTargetJob


class TargetPreparationRepository:
    def __init__(self, client: Any, *, worker_id: str, lease_seconds: int) -> None:
        self.client = client
        self.worker_id = worker_id
        self.lease_seconds = lease_seconds

    def claim_next(self) -> PlacementTargetJob | None:
        response = self.client.rpc(
            "claim_next_placement_target_job",
            {"p_worker_id": self.worker_id, "p_lease_seconds": self.lease_seconds},
        ).execute()
        rows = response.data or []
        return PlacementTargetJob.from_row(rows[0]) if rows else None

    def record_masklet(
        self,
        job: PlacementTargetJob,
        *,
        frame_index: int,
        storage_key: str,
        confidence: float | None,
        is_occluded: bool,
    ) -> None:
        self.client.table("placement_masks").upsert(
            {
                "target_id": job.target_id,
                "owner_id": job.owner_id,
                "frame_index": frame_index,
                "kind": "target",
                "storage_key": storage_key,
                "bbox": job.seed_bbox,
                "confidence": confidence,
                "is_occluded": is_occluded,
                "revision": job.manual_revision,
            },
            on_conflict="target_id,frame_index,kind,revision",
        ).execute()

    def complete(
        self,
        job: PlacementTargetJob,
        *,
        manifest_key: str,
        metrics: dict[str, Any],
        start_frame: int,
        end_frame: int,
        shot_start_frame: int,
        shot_end_frame: int,
    ) -> None:
        now = datetime.now(UTC).isoformat()
        self.client.table("placement_target_jobs").update(
            {
                "status": "complete",
                "output_manifest_key": manifest_key,
                "metrics": metrics,
                "lease_expires_at": None,
                "completed_at": now,
                "error": None,
            }
        ).eq("id", job.id).execute()
        self.client.table("placement_targets").update(
            {
                "status": "ready",
                "tracking_provider": job.tracking_provider,
                "tracking_model": job.tracking_model,
                "start_frame": start_frame,
                "end_frame": end_frame,
                "shot_start_frame": shot_start_frame,
                "shot_end_frame": shot_end_frame,
                "updated_at": now,
            }
        ).eq("id", job.target_id).execute()

    def needs_review(self, job: PlacementTargetJob, message: str, *, manifest_key: str | None = None) -> None:
        now = datetime.now(UTC).isoformat()
        self.client.table("placement_target_jobs").update(
            {
                "status": "needs_review",
                "output_manifest_key": manifest_key,
                "lease_expires_at": None,
                "completed_at": now,
                "error": message[:500],
            }
        ).eq("id", job.id).execute()
        self.client.table("placement_targets").update(
            {"status": "needs_review", "updated_at": now}
        ).eq("id", job.target_id).execute()

    def fail(self, job: PlacementTargetJob, message: str) -> None:
        now = datetime.now(UTC).isoformat()
        self.client.table("placement_target_jobs").update(
            {
                "status": "failed",
                "lease_expires_at": None,
                "completed_at": now,
                "error": message[:500],
            }
        ).eq("id", job.id).execute()
        self.client.table("placement_targets").update(
            {"status": "failed", "updated_at": now}
        ).eq("id", job.target_id).execute()
