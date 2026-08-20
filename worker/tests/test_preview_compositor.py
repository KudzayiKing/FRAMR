from __future__ import annotations

import unittest

import cv2
import numpy as np

from framr_worker.frame_pipeline import FramePreservingPipeline


class AutomaticPreviewCompositorTests(unittest.TestCase):
    def test_product_composite_changes_only_masked_pixels(self) -> None:
        frame = np.full((8, 8, 3), 20, dtype=np.uint8)
        mask = np.zeros((8, 8), dtype=np.uint8)
        mask[2:6, 2:6] = 255
        product = np.full((2, 2, 3), (0, 180, 240), dtype=np.uint8)
        alpha = np.full((2, 2), 255, dtype=np.uint8)

        rendered = FramePreservingPipeline._composite_product(cv2, np, frame.copy(), mask, product, alpha)

        self.assertTrue(np.array_equal(rendered[0:2, 0:2], frame[0:2, 0:2]))
        self.assertTrue(np.array_equal(rendered[6:8, 6:8], frame[6:8, 6:8]))
        self.assertFalse(np.array_equal(rendered[3, 3], frame[3, 3]))


if __name__ == "__main__":
    unittest.main()
