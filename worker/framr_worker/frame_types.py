from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Literal


FrameStage = Literal[
    "prepare_source",
    "segment_target",
    "track_target",
    "select_keyframes",
    "edit_keyframes",
    "propagate_frames",
    "composite_frames",
    "quality_check",
    "render_video",
]

FRAME_STAGES: tuple[FrameStage, ...] = (
    "prepare_source",
    "segment_target",
    "track_target",
    "select_keyframes",
    "edit_keyframes",
    "propagate_frames",
    "composite_frames",
    "quality_check",
    "render_video",
)


@dataclass(frozen=True)
class PlacementStageJob:
    id: str
    run_id: str
    owner_id: str
    job_type: FrameStage
    sequence: int
    attempt: int
    input_manifest_key: str | None
    run_settings: dict[str, Any]
    source_video_id: str
    placement_id: str
    target_id: str | None
    product_id: str
    segmentation_provider: str
    segmentation_model: str
    image_editor_provider: str
    image_editor_model: str
    propagation_provider: str
    propagation_model: str

    @classmethod
    def from_row(cls, row: dict[str, Any]) -> "PlacementStageJob":
        job_type = str(row["job_type"])
        if job_type not in FRAME_STAGES:
            raise ValueError(f"Unsupported frame-preserving stage: {job_type}")
        settings = row.get("run_settings")
        return cls(
            id=str(row["id"]),
            run_id=str(row["run_id"]),
            owner_id=str(row["owner_id"]),
            job_type=job_type,  # type: ignore[arg-type]
            sequence=int(row["sequence"]),
            attempt=int(row["attempt"]),
            input_manifest_key=row.get("input_manifest_key"),
            run_settings=settings if isinstance(settings, dict) else {},
            source_video_id=str(row["source_video_id"]),
            placement_id=str(row["placement_id"]),
            target_id=str(row["target_id"]) if row.get("target_id") else None,
            product_id=str(row["product_id"]),
            segmentation_provider=str(row["segmentation_provider"]),
            segmentation_model=str(row["segmentation_model"]),
            image_editor_provider=str(row["image_editor_provider"]),
            image_editor_model=str(row["image_editor_model"]),
            propagation_provider=str(row["propagation_provider"]),
            propagation_model=str(row["propagation_model"]),
        )


@dataclass(frozen=True)
class PlacementRunContext:
    storage_key: str
    duration_seconds: float
    frame_rate: float
    frame_count: int
    target_start_frame: int
    target_end_frame: int
    target_seed_frame: int
    target_seed_bbox: dict[str, float] | None
    target_seed_mask_key: str | None
    target_revision: int
    product_reference_keys: tuple[str, ...]


@dataclass(frozen=True)
class StageOutcome:
    output_manifest_key: str | None
    metrics: dict[str, Any]
    progress: float


class ProviderUnavailable(RuntimeError):
    """Raised when an intentional development adapter reaches a real model boundary."""


class NeedsReview(RuntimeError):
    """Raised when the system must stop safely instead of fabricating a render."""
