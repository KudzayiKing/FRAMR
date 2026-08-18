from __future__ import annotations

from collections import defaultdict
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from .models import AnalysisResult, DetectedObject, NormalizedBox, Scene, TrackPoint, VideoJob, VideoMetadata

IGNORED_LABELS = {"person", "car", "motorcycle", "bicycle", "bus", "truck", "traffic light", "stop sign"}
CATEGORY_BY_LABEL = {
    "bottle": "Pantry",
    "cup": "Tableware",
    "wine glass": "Tableware",
    "fork": "Tableware",
    "knife": "Tableware",
    "spoon": "Tableware",
    "bowl": "Tableware",
    "microwave": "Kitchen appliances",
    "oven": "Kitchen appliances",
    "toaster": "Kitchen appliances",
    "refrigerator": "Kitchen appliances",
    "tv": "Technology",
    "laptop": "Technology",
    "cell phone": "Technology",
    "keyboard": "Technology",
    "mouse": "Technology",
    "headphones": "Technology",
}


@dataclass
class TrackAggregate:
    label: str
    category: str
    confidences: list[float] = field(default_factory=list)
    points: list[TrackPoint] = field(default_factory=list)

    def append(self, confidence: float, point: TrackPoint) -> None:
        self.confidences.append(confidence)
        self.points.append(point)


class LiveAnalyzer:
    def __init__(self, model_name: str = "yolo11n.pt", tracker_config: str = "bytetrack.yaml", confidence: float = 0.35) -> None:
        self.model_name = model_name
        self.tracker_config = tracker_config
        self.confidence = confidence

    def analyze(self, job: VideoJob, metadata: VideoMetadata, source_path: Path) -> AnalysisResult:
        try:
            from ultralytics import YOLO
        except ImportError as error:
            raise RuntimeError("Live analysis requires the ultralytics package. Install worker/requirements.txt first.") from error
        model = YOLO(self.model_name)
        tracks: dict[tuple[str, int], TrackAggregate] = {}
        results = model.track(
            source=str(source_path),
            stream=True,
            persist=True,
            tracker=self.tracker_config,
            conf=self.confidence,
            verbose=False,
        )
        for frame_index, result in enumerate(results):
            boxes = getattr(result, "boxes", None)
            if boxes is None or boxes.id is None:
                continue
            track_ids = boxes.id.int().cpu().tolist()
            coordinates = boxes.xyxy.cpu().tolist()
            confidences = boxes.conf.cpu().tolist()
            classes = boxes.cls.int().cpu().tolist()
            names = result.names
            for track_id, xyxy, confidence, class_id in zip(track_ids, coordinates, confidences, classes, strict=True):
                label = str(names[int(class_id)]).replace("_", " ").strip()
                if label in IGNORED_LABELS:
                    continue
                box = self._normalized_box(xyxy, metadata.width, metadata.height)
                if box.width * box.height < 0.01:
                    continue
                key = (label, int(track_id))
                aggregate = tracks.setdefault(key, TrackAggregate(label=label, category=self._category_for(label)))
                aggregate.append(float(confidence), TrackPoint(frame_index=frame_index, box=box))
        objects = tuple(self._to_detected_object(aggregate, metadata) for aggregate in tracks.values() if self._is_placement_candidate(aggregate, metadata))
        return AnalysisResult(scenes=(Scene(start_seconds=0.0, end_seconds=metadata.duration_seconds, objects=objects),))

    @staticmethod
    def _normalized_box(xyxy: list[float], width: int, height: int) -> NormalizedBox:
        x1, y1, x2, y2 = [float(value) for value in xyxy]
        left = max(0.0, min(1.0, x1 / width))
        top = max(0.0, min(1.0, y1 / height))
        right = max(left, min(1.0, x2 / width))
        bottom = max(top, min(1.0, y2 / height))
        return NormalizedBox(left=left, top=top, width=right - left, height=bottom - top)

    @staticmethod
    def _is_placement_candidate(aggregate: TrackAggregate, metadata: VideoMetadata) -> bool:
        if len(aggregate.points) < 2:
            return False
        duration = (aggregate.points[-1].frame_index - aggregate.points[0].frame_index) / max(metadata.frame_rate, 1.0)
        return duration >= 2.0

    @staticmethod
    def _category_for(label: str) -> str:
        return CATEGORY_BY_LABEL.get(label, "General objects")

    @staticmethod
    def _quality(duration: float, confidence: float, area: float) -> str:
        if duration >= 8.0 and confidence >= 0.70 and area >= 0.05:
            return "Excellent"
        if duration >= 5.0 and confidence >= 0.55 and area >= 0.03:
            return "Good"
        if duration >= 3.0:
            return "Limited"
        return "Fair"

    def _to_detected_object(self, aggregate: TrackAggregate, metadata: VideoMetadata) -> DetectedObject:
        points = tuple(aggregate.points)
        average_confidence = sum(aggregate.confidences) / len(aggregate.confidences)
        start_seconds = points[0].frame_index / max(metadata.frame_rate, 1.0)
        end_seconds = min(metadata.duration_seconds, points[-1].frame_index / max(metadata.frame_rate, 1.0))
        representative = points[len(points) // 2].box
        return DetectedObject(
            label=aggregate.label,
            category=aggregate.category,
            confidence=round(average_confidence, 4),
            box=representative,
            start_seconds=start_seconds,
            end_seconds=max(start_seconds + 0.01, end_seconds),
            quality=self._quality(end_seconds - start_seconds, average_confidence, representative.width * representative.height),
            tracks=points,
        )
