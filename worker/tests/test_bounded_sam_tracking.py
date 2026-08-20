from __future__ import annotations

import tempfile
import unittest
from pathlib import Path

import cv2
import numpy as np

from framr_worker.sam2_provider import Sam2VideoSegmentationProvider


class BoundedSamTrackingTests(unittest.TestCase):
    def test_selected_interval_is_bounded_and_contains_seed(self) -> None:
        indices = Sam2VideoSegmentationProvider._sample_indices(
            start=180,
            end=1080,
            seed=630,
            max_frames=48,
        )

        self.assertEqual(len(indices), 48)
        self.assertEqual(indices[0], 180)
        self.assertEqual(indices[-1], 1080)
        self.assertIn(630, indices)
        self.assertEqual(indices, tuple(sorted(set(indices))))

    def test_short_interval_keeps_every_source_frame(self) -> None:
        indices = Sam2VideoSegmentationProvider._sample_indices(
            start=10,
            end=20,
            seed=12,
            max_frames=48,
        )

        self.assertEqual(indices, tuple(range(10, 21)))

    def test_sparse_mask_geometry_marks_a_sustained_transition(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            areas = [(0, 100), (30, 400), (60, 360), (90, 355)]
            paths = []
            for frame, area in areas:
                mask = np.zeros((40, 40), dtype=np.uint8)
                width = max(1, int(area**0.5))
                mask[:width, :width] = 255
                path = root / f"mask-{frame:06d}.png"
                cv2.imwrite(str(path), mask)
                paths.append(path)
            transitions = Sam2VideoSegmentationProvider._infer_transition_frames(cv2, tuple(paths))
        self.assertEqual(transitions, (30,))

    def test_tail_metadata_is_clamped_to_the_last_decodable_frame(self) -> None:
        class Cv2:
            CAP_PROP_POS_FRAMES = 1

        class Capture:
            def __init__(self) -> None:
                self.position = 0

            def set(self, _property: int, value: int) -> None:
                self.position = value

            def read(self):
                return (self.position <= 12, object())

        self.assertEqual(
            Sam2VideoSegmentationProvider._last_decodable_frame(Cv2, Capture(), start=10, requested_end=13),
            12,
        )


if __name__ == "__main__":
    unittest.main()
