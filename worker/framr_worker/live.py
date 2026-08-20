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
COOKWARE_PROMPTS = (
    "cooking pot",
    "saucepan",
    "frying pan",
    "wok",
    "kettle",
    "rice cooker",
    "coffee machine",
    "mug",
    "food container",
    "product package",
)


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
    def __init__(
        self,
        model_name: str = "yolo11n.pt",
        tracker_config: str = "bytetrack.yaml",
        confidence: float = 0.35,
        *,
        open_vocabulary_enabled: bool = True,
        open_vocabulary_model: str = "yolov8s-world.pt",
        open_vocabulary_prompts: tuple[str, ...] = COOKWARE_PROMPTS,
        open_vocabulary_confidence: float = 0.20,
        open_vocabulary_samples: int = 24,
        open_vocabulary_device: str | None = "mps",
    ) -> None:
        self.model_name = model_name
        self.tracker_config = tracker_config
        self.confidence = confidence
        self.open_vocabulary_enabled = open_vocabulary_enabled
        self.open_vocabulary_model = open_vocabulary_model
        self.open_vocabulary_prompts = open_vocabulary_prompts
        self.open_vocabulary_confidence = open_vocabulary_confidence
        self.open_vocabulary_samples = max(4, open_vocabulary_samples)
        self.open_vocabulary_device = open_vocabulary_device or None

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

        objects = [self._to_detected_object(aggregate, metadata) for aggregate in tracks.values() if self._is_placement_candidate(aggregate, metadata)]
        if self.open_vocabulary_enabled:
            objects.extend(self._open_vocabulary_objects(source_path, metadata, existing=objects))
        return AnalysisResult(scenes=(Scene(start_seconds=0.0, end_seconds=metadata.duration_seconds, objects=tuple(objects)),))

    def _open_vocabulary_objects(self, source_path: Path, metadata: VideoMetadata, *, existing: list[DetectedObject]) -> list[DetectedObject]:
        try:
            import cv2
            from ultralytics import YOLO
        except ImportError as error:
            raise RuntimeError("Open-vocabulary analysis requires OpenCV and Ultralytics.") from error

        model = YOLO(self.open_vocabulary_model)
        model.set_classes(list(self.open_vocabulary_prompts))
        capture = cv2.VideoCapture(str(source_path))
        if not capture.isOpened():
            return []
        frame_count = max(1, metadata.frame_count or round(metadata.duration_seconds * metadata.frame_rate))
        interval = max(1, frame_count // self.open_vocabulary_samples)
        sample_indices = sorted(set([min(frame_count - 1, index * interval) for index in range(self.open_vocabulary_samples)] + [frame_count - 1]))
        tracks: list[TrackAggregate] = []
        try:
            for frame_index in sample_indices:
                capture.set(cv2.CAP_PROP_POS_FRAMES, frame_index)
                ok, frame = capture.read()
                if not ok or frame is None:
                    continue
                result = model.predict(
                    frame,
                    conf=self.open_vocabulary_confidence,
                    verbose=False,
                    device=self.open_vocabulary_device,
                )[0]
                boxes = getattr(result, "boxes", None)
                if boxes is None:
                    continue
                coordinates = boxes.xyxy.cpu().tolist()
                confidences = boxes.conf.cpu().tolist()
                classes = boxes.cls.int().cpu().tolist()
                names = result.names
                for xyxy, confidence, class_id in zip(coordinates, confidences, classes, strict=True):
                    label = self._normalize_open_label(str(names[int(class_id)]))
                    box = self._normalized_box(xyxy, metadata.width, metadata.height)
                    if box.width * box.height < 0.01:
                        continue
                    self._append_open_track(tracks, label, float(confidence), TrackPoint(frame_index=frame_index, box=box), interval)
        finally:
            capture.release()

        proposals = [self._to_detected_object(track, metadata) for track in tracks if self._is_placement_candidate(track, metadata)]
        return [proposal for proposal in proposals if not any(self._same_object(proposal, detected) for detected in existing)]

    @staticmethod
    def _append_open_track(tracks: list[TrackAggregate], label: str, confidence: float, point: TrackPoint, interval: int) -> None:
        candidates = [track for track in tracks if track.label == label and track.points and point.frame_index - track.points[-1].frame_index <= interval * 2]
        match = max(candidates, key=lambda track: LiveAnalyzer._iou(track.points[-1].box, point.box), default=None)
        if match is not None and LiveAnalyzer._iou(match.points[-1].box, point.box) >= 0.20:
            match.append(confidence, point)
            return
        track = TrackAggregate(label=label, category="Cookware" if label in {"Cooking pot", "Saucepan", "Frying pan", "Wok", "Kettle"} else "Commercial objects")
        track.append(confidence, point)
        tracks.append(track)

    @staticmethod
    def _normalize_open_label(label: str) -> str:
        normalized = label.strip().lower()
        names = {
            "cooking pot": "Cooking pot",
            "saucepan": "Saucepan",
            "frying pan": "Frying pan",
            "wok": "Wok",
            "kettle": "Kettle",
            "rice cooker": "Rice cooker",
            "coffee machine": "Coffee machine",
            "mug": "Mug",
            "food container": "Food container",
            "product package": "Product package",
        }
        return names.get(normalized, label.replace("_", " ").strip().title())

    @staticmethod
    def _same_object(first: DetectedObject, second: DetectedObject) -> bool:
        if first.label == second.label:
            return LiveAnalyzer._iou(first.box, second.box) >= 0.55
        cookware = {"Cooking pot", "Saucepan", "Frying pan", "Wok", "Kettle", "bowl"}
        return first.label in cookware and second.label in cookware and LiveAnalyzer._iou(first.box, second.box) >= 0.75

    @staticmethod
    def _iou(first: NormalizedBox, second: NormalizedBox) -> float:
        left = max(first.left, second.left)
        top = max(first.top, second.top)
        right = min(first.left + first.width, second.left + second.width)
        bottom = min(first.top + first.height, second.top + second.height)
        intersection = max(0.0, right - left) * max(0.0, bottom - top)
        union = first.width * first.height + second.width * second.height - intersection
        return intersection / union if union > 0 else 0.0

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
