from __future__ import annotations

import unittest

from framr_worker.live import LiveAnalyzer, TrackAggregate
from framr_worker.models import NormalizedBox, TrackPoint, VideoMetadata


class LiveAnalyzerTests(unittest.TestCase):
    def setUp(self) -> None:
        self.metadata = VideoMetadata(30.0, 1080, 1920, "h264", 30.0)

    def test_category_and_quality_mapping(self) -> None:
        analyzer = LiveAnalyzer()
        self.assertEqual(analyzer._category_for("microwave"), "Kitchen appliances")
        self.assertEqual(analyzer._category_for("cup"), "Tableware")
        self.assertEqual(analyzer._quality(10.0, 0.9, 0.1), "Excellent")

    def test_candidate_requires_visible_duration(self) -> None:
        aggregate = TrackAggregate(label="bottle", category="Pantry")
        aggregate.append(0.9, TrackPoint(0, NormalizedBox(0.1, 0.2, 0.1, 0.2)))
        aggregate.append(0.9, TrackPoint(90, NormalizedBox(0.1, 0.2, 0.1, 0.2)))
        self.assertTrue(LiveAnalyzer._is_placement_candidate(aggregate, self.metadata))
