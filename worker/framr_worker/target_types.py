from __future__ import annotations

from dataclasses import dataclass
from typing import Any


@dataclass(frozen=True)
class PlacementTargetJob:
    id: str
    target_id: str
    owner_id: str
    job_type: str
    attempt: int
    placement_id: str
    source_video_id: str
    source_storage_key: str
    frame_rate: float
    frame_count: int
    seed_frame: int
    start_frame: int
    end_frame: int
    seed_bbox: dict[str, float] | None
    seed_mask_key: str | None
    manual_revision: int
    tracking_provider: str
    tracking_model: str

    @classmethod
    def from_row(cls, row: dict[str, Any]) -> "PlacementTargetJob":
        if str(row.get("job_type")) != "segment_and_track":
            raise ValueError(f"Unsupported target-preparation job: {row.get('job_type')}")
        bbox = row.get("seed_bbox")
        return cls(
            id=str(row["id"]),
            target_id=str(row["target_id"]),
            owner_id=str(row["owner_id"]),
            job_type="segment_and_track",
            attempt=int(row["attempt"]),
            placement_id=str(row["placement_id"]),
            source_video_id=str(row["source_video_id"]),
            source_storage_key=str(row["source_storage_key"]),
            frame_rate=float(row.get("frame_rate") or 30.0),
            frame_count=int(row.get("frame_count") or 0),
            seed_frame=int(row["seed_frame"]),
            start_frame=int(row["start_frame"]),
            end_frame=int(row["end_frame"]),
            seed_bbox=bbox if isinstance(bbox, dict) else None,
            seed_mask_key=str(row["seed_mask_key"]) if row.get("seed_mask_key") else None,
            manual_revision=int(row.get("manual_revision") or 0),
            tracking_provider=str(row.get("tracking_provider") or "sam2"),
            tracking_model=str(row.get("tracking_model") or "sam2.1-hiera-tiny"),
        )


class TargetNeedsReview(RuntimeError):
    """Raised when automatic target preparation needs a creator correction."""
