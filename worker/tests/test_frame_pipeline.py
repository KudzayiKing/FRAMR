from __future__ import annotations

import json
import tempfile
import unittest
from pathlib import Path

from framr_worker.frame_pipeline import FramePreservingPipeline
from framr_worker.frame_types import FRAME_STAGES, PlacementRunContext, PlacementStageJob


class FakeRepository:
    def __init__(self, job: PlacementStageJob) -> None:
        self.job = job
        self.claimed = False
        self.completed = []
        self.blocked = []
        self.failed = []

    def claim_next(self):
        if self.claimed:
            return None
        self.claimed = True
        return self.job

    def load_context(self, _job):
        return PlacementRunContext(
            storage_key="videos/owner-1/source.mp4",
            duration_seconds=8.0,
            frame_rate=30.0,
            frame_count=240,
            target_start_frame=30,
            target_end_frame=150,
            target_seed_frame=90,
            target_seed_bbox={"left": 0.2, "top": 0.2, "width": 0.1, "height": 0.1},
            target_seed_mask_key="artifacts/owner-1/run-1/masks/seed.png",
            target_revision=1,
            product_reference_keys=("products/owner-1/product.png",),
        )

    def list_masklets(self, _job, *, revision):
        self.last_masklet_revision = revision
        return []

    def complete_stage(self, job, outcome):
        self.completed.append((job, outcome))

    def block_for_review(self, job, message, *, manifest_key=None):
        self.blocked.append((job, message, manifest_key))

    def fail_stage(self, job, message):
        self.failed.append((job, message))


class FakeStorage:
    def __init__(self) -> None:
        self.uploads: list[tuple[str, str, str, bytes, str]] = []

    def download_source_video(self, _storage_key, destination_path):
        destination_path.write_bytes(b"source-video")

    def download_private_object(self, _storage_key):
        return b"seed-mask"

    def upload_artifact_bytes(self, owner_id, run_id, relative_path, payload, *, content_type):
        self.uploads.append((owner_id, run_id, relative_path, payload, content_type))
        return f"artifacts/{owner_id}/{run_id}/{relative_path}"


def job_for(stage: str, sequence: int) -> PlacementStageJob:
    return PlacementStageJob(
        id="step-1",
        run_id="run-1",
        owner_id="owner-1",
        job_type=stage,  # type: ignore[arg-type]
        sequence=sequence,
        attempt=1,
        input_manifest_key=None,
        run_settings={"frameMode": "ADAPTIVE"},
        source_video_id="video-1",
        placement_id="placement-1",
        target_id="target-1",
        product_id="product-1",
        segmentation_provider="dev-mask",
        segmentation_model="dev-mask-v1",
        image_editor_provider="dev-localized-editor",
        image_editor_model="source-preserving-v1",
        propagation_provider="dev-propagation",
        propagation_model="identity-v1",
    )


class FramePreservingPipelineTests(unittest.TestCase):
    def test_stage_order_is_explicit_and_starts_with_source_preparation(self) -> None:
        self.assertEqual(FRAME_STAGES[0], "prepare_source")
        self.assertEqual(FRAME_STAGES[-1], "render_video")
        self.assertEqual(len(FRAME_STAGES), 9)

    def test_prepare_source_writes_private_manifest_without_editing_pixels(self) -> None:
        repository = FakeRepository(job_for("prepare_source", 0))
        storage = FakeStorage()
        with tempfile.TemporaryDirectory() as directory:
            processed = FramePreservingPipeline(repository=repository, storage=storage, work_dir=Path(directory)).process_next()
        self.assertTrue(processed)
        self.assertEqual(len(repository.completed), 1)
        self.assertEqual(repository.blocked, [])
        self.assertEqual(repository.failed, [])
        self.assertEqual(len(storage.uploads), 1)
        payload = json.loads(storage.uploads[0][3])
        self.assertEqual(payload["source"]["storage_key"], "videos/owner-1/source.mp4")
        self.assertTrue(payload["source"]["immutable"])
        self.assertEqual(payload["source"]["audio_policy"], "preserve_original")
        self.assertEqual(payload["target"]["seed_frame"], 90)

    def test_keyframe_selection_keeps_seed_and_temporal_coverage(self) -> None:
        masklets = [{"frame_index": frame_index, "is_occluded": False} for frame_index in range(0, 361, 30)]
        selected = FramePreservingPipeline._select_evenly_spaced(masklets, seed_frame=175)
        selected_frames = [int(row["frame_index"]) for row in selected]
        self.assertIn(180, selected_frames)
        self.assertEqual(selected_frames[0], 0)
        self.assertEqual(selected_frames[-1], 360)
        self.assertGreaterEqual(len(selected_frames), 3)
        self.assertLessEqual(len(selected_frames), 8)

    def test_segmentation_without_a_verified_provider_blocks_for_review(self) -> None:
        repository = FakeRepository(job_for("segment_target", 1))
        storage = FakeStorage()
        with tempfile.TemporaryDirectory() as directory:
            processed = FramePreservingPipeline(repository=repository, storage=storage, work_dir=Path(directory)).process_next()
        self.assertTrue(processed)
        self.assertEqual(repository.completed, [])
        self.assertEqual(repository.failed, [])
        self.assertEqual(len(repository.blocked), 1)
        self.assertIn("Segmentation is not configured", repository.blocked[0][1])
        self.assertEqual(len(storage.uploads), 1)


if __name__ == "__main__":
    unittest.main()
