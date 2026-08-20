from __future__ import annotations

import tempfile
import unittest
from pathlib import Path

import cv2
import numpy as np

from framr_worker.frame_providers import SegmentationResult
from framr_worker.target_pipeline import TargetPreparationPipeline
from framr_worker.target_types import PlacementTargetJob


class FakeTargetRepository:
    def __init__(self, job: PlacementTargetJob) -> None:
        self.job = job
        self.claimed = False
        self.masklets: list[dict[str, object]] = []
        self.completed: list[tuple[PlacementTargetJob, str, dict[str, object], int, int, int, int]] = []
        self.reviewed: list[tuple[PlacementTargetJob, str]] = []
        self.failed: list[tuple[PlacementTargetJob, str]] = []

    def claim_next(self):
        if self.claimed:
            return None
        self.claimed = True
        return self.job

    def record_masklet(self, _job, **values):
        self.masklets.append(values)

    def complete(self, job, *, manifest_key, metrics, start_frame, end_frame, shot_start_frame, shot_end_frame):
        self.completed.append((job, manifest_key, metrics, start_frame, end_frame, shot_start_frame, shot_end_frame))

    def needs_review(self, job, message, *, manifest_key=None):
        self.reviewed.append((job, message))

    def fail(self, job, message):
        self.failed.append((job, message))


class FakeStorage:
    def __init__(self) -> None:
        self.uploads: list[tuple[str, str, str, bytes]] = []

    def download_source_video(self, _key, destination):
        destination.write_bytes(b"synthetic-source")

    def download_private_object(self, _key):
        return b"manual-seed"

    def upload_artifact_bytes(self, owner_id, target_id, relative_path, payload, *, content_type):
        self.uploads.append((owner_id, target_id, relative_path, payload))
        return f"artifacts/{owner_id}/{target_id}/{relative_path}"


class FakeSegmentationProvider:
    name = "sam2"
    model = "sam2.1-hiera-tiny"

    def __init__(self) -> None:
        self.request = None

    def segment_and_track(self, request):
        self.request = request
        request.output_directory.mkdir(parents=True, exist_ok=True)
        mask = request.output_directory / "mask-000012.png"
        cv2.imwrite(str(mask), np.full((32, 32), 255, dtype=np.uint8))
        return SegmentationResult(mask_paths=(mask,), average_confidence=0.98, has_occlusion=False)


def automatic_box_job() -> PlacementTargetJob:
    return PlacementTargetJob(
        id="target-job-1",
        target_id="target-1",
        owner_id="owner-1",
        job_type="segment_and_track",
        attempt=1,
        placement_id="placement-1",
        source_video_id="video-1",
        source_storage_key="videos/owner-1/source.mp4",
        frame_rate=30,
        frame_count=240,
        seed_frame=12,
        start_frame=10,
        end_frame=20,
        seed_bbox={"left": 0.2, "top": 0.3, "width": 0.2, "height": 0.1},
        seed_mask_key=None,
        manual_revision=0,
        tracking_provider="sam2",
        tracking_model="sam2.1-hiera-tiny",
    )


class TargetPreparationPipelineTests(unittest.TestCase):
    def test_automatic_target_uses_detected_box_without_manual_mask(self) -> None:
        job = automatic_box_job()
        repository = FakeTargetRepository(job)
        storage = FakeStorage()
        provider = FakeSegmentationProvider()
        with tempfile.TemporaryDirectory() as directory:
            processed = TargetPreparationPipeline(
                repository=repository,
                storage=storage,
                work_dir=Path(directory),
                segmentation_provider=provider,
            ).process_next()
        self.assertTrue(processed)
        self.assertIsNotNone(provider.request)
        self.assertIsNone(provider.request.prompt_mask_path)
        self.assertEqual(provider.request.prompt_bbox, job.seed_bbox)
        self.assertEqual(provider.request.start_frame, 0)
        self.assertEqual(provider.request.end_frame, job.frame_count - 1)
        self.assertEqual(provider.request.max_tracking_frames, 72)
        self.assertEqual(len(repository.masklets), 1)
        self.assertEqual(len(repository.completed), 1)
        self.assertEqual(repository.reviewed, [])
        self.assertEqual(repository.failed, [])
        self.assertGreaterEqual(len(storage.uploads), 2)
        self.assertEqual(repository.completed[0][3:], (job.seed_frame, job.seed_frame, 0, job.frame_count - 1))

    def test_visible_bounds_keep_the_contiguous_run_containing_seed(self) -> None:
        bounds = TargetPreparationPipeline._visible_target_bounds(
            seed_frame=108,
            visible_frame_indices=[90, 96, 102, 108, 114, 120, 180, 186],
            shot_start_frame=0,
            shot_end_frame=239,
        )
        self.assertEqual(bounds, (90, 120))

    def test_shot_bounds_choose_cuts_around_seed(self) -> None:
        bounds = TargetPreparationPipeline._shot_bounds_from_cuts(
            seed_frame=155,
            frame_count=300,
            cut_frames=[75, 150, 220, 290],
        )
        self.assertEqual(bounds, (150, 219))

    def test_shot_bounds_cover_full_source_when_no_cut_exists(self) -> None:
        bounds = TargetPreparationPipeline._shot_bounds_from_cuts(
            seed_frame=42,
            frame_count=120,
            cut_frames=[],
        )
        self.assertEqual(bounds, (0, 119))


if __name__ == "__main__":
    unittest.main()
