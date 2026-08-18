from __future__ import annotations

from pathlib import Path

from .models import AnalysisResult, DetectedObject, NormalizedBox, Scene, TrackPoint, VideoJob, VideoMetadata


class MockAnalyzer:
    """Deterministic analysis for demos and tests; it never reads a model or network."""

    def analyze(self, job: VideoJob, metadata: VideoMetadata, source_path: Path | None = None) -> AnalysisResult:
        duration = metadata.duration_seconds
        first_scene_end = min(duration, 20.0)
        second_scene_start = min(first_scene_end, duration)
        cooker = DetectedObject(
            label="Rice cooker",
            category="Kitchen appliances",
            confidence=0.96,
            box=NormalizedBox(left=0.45, top=0.11, width=0.49, height=0.47),
            start_seconds=3.0,
            end_seconds=max(4.0, min(first_scene_end, 18.0)),
            quality="Excellent",
            tracks=self._track(0.45, 0.11, 0.49, 0.47, 18),
        )
        scenes: list[Scene] = [Scene(start_seconds=0.0, end_seconds=first_scene_end, objects=(cooker,))]
        if duration > second_scene_start:
            cup_start = min(second_scene_start + 1.0, max(0.0, duration - 4.0))
            cup = DetectedObject(
                label="Ceramic cup",
                category="Tableware",
                confidence=0.86,
                box=NormalizedBox(left=0.40, top=0.58, width=0.32, height=0.24),
                start_seconds=cup_start,
                end_seconds=min(duration, cup_start + 7.0),
                quality="Good",
                tracks=self._track(0.40, 0.58, 0.32, 0.24, 8),
            )
            scenes.append(Scene(start_seconds=second_scene_start, end_seconds=duration, objects=(cup,)))
        return AnalysisResult(scenes=tuple(scenes))

    @staticmethod
    def _track(left: float, top: float, width: float, height: float, frames: int) -> tuple[TrackPoint, ...]:
        return tuple(
            TrackPoint(
                frame_index=index * 5,
                box=NormalizedBox(
                    left=min(1 - width, max(0.0, left + index * 0.0015)),
                    top=min(1 - height, max(0.0, top + index * 0.0008)),
                    width=width,
                    height=height,
                ),
            )
            for index in range(frames)
        )
