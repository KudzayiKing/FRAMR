from __future__ import annotations

import unittest

from framr_worker.mock import MockAnalyzer
from framr_worker.models import VideoJob, VideoMetadata


class MockAnalyzerTests(unittest.TestCase):
    def setUp(self) -> None:
        self.job = VideoJob("video-1", "owner-1", "Demo upload", 34.0, 1080, 1920, "videos/owner-1/demo.mp4", 1)
        self.metadata = VideoMetadata(34.0, 1080, 1920, "h264", 30.0)

    def test_mock_result_is_deterministic_and_placement_ready(self) -> None:
        first = MockAnalyzer().analyze(self.job, self.metadata)
        second = MockAnalyzer().analyze(self.job, self.metadata)
        self.assertEqual(first, second)
        self.assertEqual(len(first.scenes), 2)
        cooker = first.scenes[0].objects[0]
        self.assertEqual(cooker.label, "Rice cooker")
        self.assertEqual(cooker.quality, "Excellent")
        self.assertGreater(len(cooker.tracks), 10)
        self.assertTrue(0 <= cooker.box.left <= 1)
        self.assertTrue(0 < cooker.box.width <= 1)

    def test_mock_result_respects_short_valid_runtime(self) -> None:
        result = MockAnalyzer().analyze(self.job, VideoMetadata(15.0, 1080, 1920, "h264", 30.0))
        for scene in result.scenes:
            self.assertLessEqual(scene.end_seconds, 15.0)
            for detected in scene.objects:
                self.assertLessEqual(detected.end_seconds, 15.0)
                self.assertGreaterEqual(detected.start_seconds, 0)


if __name__ == "__main__":
    unittest.main()
