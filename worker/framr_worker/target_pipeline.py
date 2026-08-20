from __future__ import annotations

import json
import logging
import re
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from .frame_providers import SegmentationProvider, SegmentationRequest
from .frame_types import ProviderUnavailable
from .storage import ObjectStorage
from .target_repository import TargetPreparationRepository
from .target_types import PlacementTargetJob, TargetNeedsReview

logger = logging.getLogger(__name__)
MASK_FRAME_PATTERN = re.compile(r"mask-(\d+)\.png$")
SHOT_CUT_THRESHOLD = 0.42
# A 72-frame sparse pass samples a 36-second clip about every 0.5 seconds while
# remaining responsive on the local Apple Silicon worker. Lucy receives a single
# continuous video window, so it does not require a dense per-frame mask sequence.
MAX_SHOT_TRACKING_FRAMES = 72


class TargetPreparationPipeline:
    """Prepare a selected placement target before product generation begins.

    A detected placement box is a valid SAM prompt. A creator-refined seed mask is
    optional and supersedes the box when supplied after a quality-review request.
    """

    def __init__(
        self,
        *,
        repository: TargetPreparationRepository,
        storage: ObjectStorage,
        work_dir: Path,
        segmentation_provider: SegmentationProvider | None,
    ) -> None:
        self.repository = repository
        self.storage = storage
        self.work_dir = work_dir
        self.segmentation_provider = segmentation_provider

    def process_next(self) -> bool:
        job = self.repository.claim_next()
        if not job:
            return False
        try:
            self._segment_and_track(job)
        except (ProviderUnavailable, TargetNeedsReview) as error:
            logger.info("target_preparation_needs_review target_id=%s reason=%s", job.target_id, error)
            self.repository.needs_review(job, str(error))
        except Exception as error:
            logger.exception("target_preparation_failed target_id=%s", job.target_id)
            self.repository.fail(job, str(error))
        return True

    def _segment_and_track(self, job: PlacementTargetJob) -> None:
        if not self.segmentation_provider:
            raise TargetNeedsReview("Automatic tracking is not configured yet. Refine the mask or enable the verified SAM 2.1 worker.")
        if not job.seed_mask_key and not job.seed_bbox:
            raise TargetNeedsReview("FRAMR could not recover a usable detection box for this object. Please refine the target once.")

        job_dir = self.work_dir / "target-preparation" / job.id
        job_dir.mkdir(parents=True, exist_ok=True)
        source_path = job_dir / "source.mp4"
        if not source_path.exists():
            self.storage.download_source_video(job.source_storage_key, source_path)

        seed_mask_path: Path | None = None
        if job.seed_mask_key:
            seed_mask_path = job_dir / "seed-mask.png"
            if not seed_mask_path.exists():
                seed_mask_path.write_bytes(self.storage.download_private_object(job.seed_mask_key))

        shot_start_frame, shot_end_frame = self._continuous_shot_bounds(
            source_path,
            seed_frame=job.seed_frame,
            frame_count=job.frame_count,
        )
        output_directory = job_dir / "tracked-masks"
        result = self.segmentation_provider.segment_and_track(
            SegmentationRequest(
                source_path=source_path,
                seed_frame=job.seed_frame,
                prompt_bbox=job.seed_bbox,
                prompt_mask_key=job.seed_mask_key,
                prompt_mask_path=seed_mask_path,
                output_directory=output_directory,
                start_frame=shot_start_frame,
                end_frame=shot_end_frame,
                max_tracking_frames=MAX_SHOT_TRACKING_FRAMES,
            )
        )

        persisted: list[dict[str, Any]] = []
        visible_frame_indices: list[int] = []
        for mask_path in result.mask_paths:
            match = MASK_FRAME_PATTERN.search(mask_path.name)
            if not match:
                continue
            frame_index = int(match.group(1))
            if frame_index < shot_start_frame or frame_index > shot_end_frame:
                continue
            if self._mask_has_visible_target(mask_path):
                visible_frame_indices.append(frame_index)
            storage_key = self.storage.upload_artifact_bytes(
                job.owner_id,
                job.target_id,
                f"automatic-targets/revision-{job.manual_revision}/mask-{frame_index:06d}.png",
                mask_path.read_bytes(),
                content_type="image/png",
            )
            self.repository.record_masklet(
                job,
                frame_index=frame_index,
                storage_key=storage_key,
                confidence=result.average_confidence,
                is_occluded=frame_index in result.occluded_frame_indices,
            )
            persisted.append({"frame_index": frame_index, "storage_key": storage_key})

        if not persisted or not visible_frame_indices:
            raise TargetNeedsReview("Automatic tracking did not find a stable mask inside the selected shot. Please refine the target once.")
        tracked_start_frame, tracked_end_frame = self._visible_target_bounds(
            seed_frame=job.seed_frame,
            visible_frame_indices=visible_frame_indices,
            shot_start_frame=shot_start_frame,
            shot_end_frame=shot_end_frame,
        )

        manifest = {
            "schema": "framr.automatic-target-preparation.v1",
            "created_at": datetime.now(UTC).isoformat(),
            "target_id": job.target_id,
            "placement_id": job.placement_id,
            "source": {"storage_key": job.source_storage_key, "immutable": True},
            "prompt": {
                "seed_frame": job.seed_frame,
                "seed_bbox": job.seed_bbox,
                "seed_mask_key": job.seed_mask_key,
                "manual_revision": job.manual_revision,
                "detected_window": {"start_frame": job.start_frame, "end_frame": job.end_frame},
                "tracked_shot_window": {"start_frame": shot_start_frame, "end_frame": shot_end_frame},
                "tracked_visibility_window": {"start_frame": tracked_start_frame, "end_frame": tracked_end_frame},
            },
            "provider": {"name": self.segmentation_provider.name, "model": self.segmentation_provider.model},
            "masklets": persisted,
            "average_confidence": result.average_confidence,
            "has_occlusion": result.has_occlusion,
            "transition_frame_indices": list(result.occluded_frame_indices),
        }
        manifest_key = self.storage.upload_artifact_bytes(
            job.owner_id,
            job.target_id,
            f"automatic-targets/revision-{job.manual_revision}/target-preparation.json",
            json.dumps(manifest, separators=(",", ":"), sort_keys=True).encode(),
            content_type="application/json",
        )
        self.repository.complete(
            job,
            manifest_key=manifest_key,
            metrics={
                "masklet_count": len(persisted),
                "average_confidence": result.average_confidence,
                "has_occlusion": result.has_occlusion,
                "transition_frame_indices": list(result.occluded_frame_indices),
                "detected_start_frame": job.start_frame,
                "detected_end_frame": job.end_frame,
                "tracked_shot_start_frame": shot_start_frame,
                "tracked_shot_end_frame": shot_end_frame,
                "tracked_visibility_start_frame": tracked_start_frame,
                "tracked_visibility_end_frame": tracked_end_frame,
            },
            start_frame=tracked_start_frame,
            end_frame=tracked_end_frame,
            shot_start_frame=shot_start_frame,
            shot_end_frame=shot_end_frame,
        )
        logger.info(
            "target_preparation_complete target_id=%s masks=%s shot=%s-%s",
            job.target_id,
            len(persisted),
            tracked_start_frame,
            tracked_end_frame,
        )

    @staticmethod
    def _mask_has_visible_target(mask_path: Path) -> bool:
        try:
            import cv2
            mask = cv2.imread(str(mask_path), cv2.IMREAD_GRAYSCALE)
            if mask is None:
                return False
            minimum_pixels = max(64, int(mask.size * 0.0005))
            return int((mask > 0).sum()) >= minimum_pixels
        except Exception:
            logger.warning("mask_visibility_check_failed mask=%s", mask_path, exc_info=True)
            return False

    @staticmethod
    def _visible_target_bounds(
        *,
        seed_frame: int,
        visible_frame_indices: list[int],
        shot_start_frame: int,
        shot_end_frame: int,
    ) -> tuple[int, int]:
        """Choose the visible run containing the seed instead of merging separate reappearances."""
        frames = sorted({frame for frame in visible_frame_indices if shot_start_frame <= frame <= shot_end_frame})
        if not frames:
            raise TargetNeedsReview("SAM did not preserve a visible target mask inside the selected shot.")
        nearest_seed_frame = min(frames, key=lambda frame: abs(frame - seed_frame))
        index = frames.index(nearest_seed_frame)
        start = nearest_seed_frame
        end = nearest_seed_frame
        # Sampling can skip source frames, so allow the expected sample spacing plus
        # one frame before declaring that the product disappeared and reappeared.
        gaps = [right - left for left, right in zip(frames, frames[1:])]
        expected_gap = max(1, min(gaps) if gaps else 1)
        while index > 0 and frames[index] - frames[index - 1] <= expected_gap * 2:
            index -= 1
            start = frames[index]
        index = frames.index(nearest_seed_frame)
        while index < len(frames) - 1 and frames[index + 1] - frames[index] <= expected_gap * 2:
            index += 1
            end = frames[index]
        return start, end

    @staticmethod
    def _shot_bounds_from_cuts(*, seed_frame: int, frame_count: int, cut_frames: list[int]) -> tuple[int, int]:
        """Return the continuous source shot containing the seed frame.

        A cut frame starts a new shot. The method is deliberately pure so its
        boundary behaviour remains covered without requiring OpenCV or SAM.
        """
        last_frame = max(0, frame_count - 1)
        seed = max(0, min(seed_frame, last_frame))
        start = 0
        end = last_frame
        for cut in sorted({max(0, min(int(value), last_frame)) for value in cut_frames}):
            if cut <= seed:
                start = cut
            elif cut > seed:
                end = max(start, cut - 1)
                break
        return start, end

    @classmethod
    def _continuous_shot_bounds(cls, source_path: Path, *, seed_frame: int, frame_count: int) -> tuple[int, int]:
        """Find the source-shot boundary around a selected object without changing media.

        The detector samples visual histograms at a bounded rate. If a source
        cannot be decoded for cut analysis, using the full source is safer than
        returning the original short YOLO interval and causing a visible product
        reversion inside a continuous shot.
        """
        safe_count = max(1, frame_count)
        try:
            import cv2
        except ImportError:
            return 0, safe_count - 1

        capture = cv2.VideoCapture(str(source_path))
        try:
            decoded_count = int(capture.get(cv2.CAP_PROP_FRAME_COUNT))
            total_frames = decoded_count if decoded_count > 0 else safe_count
            stride = max(1, round(total_frames / 360))
            previous_histogram = None
            cuts: list[int] = []
            for frame_index in range(0, total_frames, stride):
                capture.set(cv2.CAP_PROP_POS_FRAMES, frame_index)
                ok, frame = capture.read()
                if not ok:
                    continue
                gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
                small = cv2.resize(gray, (64, 64), interpolation=cv2.INTER_AREA)
                histogram = cv2.calcHist([small], [0], None, [32], [0, 256])
                cv2.normalize(histogram, histogram)
                if previous_histogram is not None:
                    distance = float(cv2.compareHist(previous_histogram, histogram, cv2.HISTCMP_BHATTACHARYYA))
                    if distance >= SHOT_CUT_THRESHOLD:
                        cuts.append(frame_index)
                previous_histogram = histogram
            return cls._shot_bounds_from_cuts(
                seed_frame=seed_frame,
                frame_count=total_frames,
                cut_frames=cuts,
            )
        except Exception:
            logger.warning("shot_boundary_detection_failed source=%s", source_path, exc_info=True)
            return 0, safe_count - 1
        finally:
            capture.release()
