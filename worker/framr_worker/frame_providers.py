from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import Protocol

from .frame_types import NeedsReview, ProviderUnavailable


@dataclass(frozen=True)
class SegmentationRequest:
    source_path: Path
    seed_frame: int
    prompt_bbox: dict[str, float] | None
    prompt_mask_key: str | None
    prompt_mask_path: Path | None
    output_directory: Path
    start_frame: int | None = None
    end_frame: int | None = None
    max_tracking_frames: int | None = None


@dataclass(frozen=True)
class SegmentationResult:
    mask_paths: tuple[Path, ...]
    average_confidence: float
    has_occlusion: bool
    # Sparse source-frame indices where the tracked target geometry changes
    # enough to create a safe state-transition boundary. The storage schema
    # retains the existing is_occluded field for this continuity signal.
    occluded_frame_indices: tuple[int, ...] = ()


@dataclass(frozen=True)
class LocalizedEditRequest:
    source_crop: Path
    target_mask: Path
    product_reference_paths: tuple[Path, ...]
    instruction: str
    source_crop_url: str | None = None
    target_mask_url: str | None = None
    product_reference_urls: tuple[str, ...] = ()


@dataclass(frozen=True)
class LocalizedEditResult:
    edited_crop: Path
    alpha_mask: Path | None


@dataclass(frozen=True)
class PropagationRequest:
    source_frames_directory: Path
    keyframe_directory: Path
    mask_directory: Path


@dataclass(frozen=True)
class PropagationResult:
    frame_directory: Path
    method: str


@dataclass(frozen=True)
class QualityRequest:
    source_frames_directory: Path
    rendered_frames_directory: Path
    target_mask_directory: Path


@dataclass(frozen=True)
class QualityResult:
    scene_preservation: float | None
    temporal_stability: float | None
    result: str
    detail: str


class SegmentationProvider(Protocol):
    name: str
    model: str

    def segment_and_track(self, request: SegmentationRequest) -> SegmentationResult: ...


class LocalizedImageEditor(Protocol):
    name: str
    model: str

    def edit_placement(self, request: LocalizedEditRequest) -> LocalizedEditResult: ...


class TemporalPropagationProvider(Protocol):
    name: str
    model: str

    def propagate(self, request: PropagationRequest) -> PropagationResult: ...


class QualityEvaluationProvider(Protocol):
    name: str
    model: str

    def evaluate(self, request: QualityRequest) -> QualityResult: ...


class DevelopmentSegmentationProvider:
    """Deliberately blocks at the real vision boundary; it never invents a mask."""

    name = "dev-mask"
    model = "dev-mask-v1"

    def segment_and_track(self, request: SegmentationRequest) -> SegmentationResult:
        raise ProviderUnavailable(
            "Segmentation is not configured. Attach a verified SAM-family provider before attempting a real placement render."
        )


class DevelopmentLocalizedImageEditor:
    """Prevents a fake replacement and prevents any whole-video fallback."""

    name = "dev-localized-editor"
    model = "source-preserving-v1"

    def edit_placement(self, request: LocalizedEditRequest) -> LocalizedEditResult:
        raise ProviderUnavailable(
            "Localized image editing is not configured. A whole-video generation fallback is intentionally disabled."
        )


class DevelopmentPropagationProvider:
    name = "dev-propagation"
    model = "identity-v1"

    def propagate(self, request: PropagationRequest) -> PropagationResult:
        raise NeedsReview("Temporal propagation is not configured for this placement run.")


class DevelopmentQualityEvaluator:
    name = "dev-quality"
    model = "integrity-v1"

    def evaluate(self, request: QualityRequest) -> QualityResult:
        return QualityResult(
            scene_preservation=None,
            temporal_stability=None,
            result="not_run",
            detail="Quality evaluation awaits real mask, localized-edit, and propagation artifacts.",
        )
