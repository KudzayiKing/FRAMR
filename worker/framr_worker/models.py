from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any


@dataclass(frozen=True)
class VideoJob:
    id: str
    owner_id: str
    title: str
    duration_seconds: float | None
    width: int | None
    height: int | None
    storage_key: str
    processing_attempts: int

    @classmethod
    def from_row(cls, row: dict[str, Any]) -> "VideoJob":
        storage_key = row.get("storage_key")
        if not isinstance(storage_key, str) or not storage_key:
            raise ValueError("Claimed video has no source storage key.")
        return cls(
            id=str(row["id"]),
            owner_id=str(row["owner_id"]),
            title=str(row["title"]),
            duration_seconds=float(row["duration_seconds"]) if row.get("duration_seconds") is not None else None,
            width=int(row["width"]) if row.get("width") is not None else None,
            height=int(row["height"]) if row.get("height") is not None else None,
            storage_key=storage_key,
            processing_attempts=int(row.get("processing_attempts", 0)),
        )


@dataclass(frozen=True)
class VideoMetadata:
    duration_seconds: float
    width: int
    height: int
    codec_name: str
    frame_rate: float
    frame_count: int = 0
    has_audio: bool = False


@dataclass(frozen=True)
class NormalizedBox:
    left: float
    top: float
    width: float
    height: float

    def as_dict(self) -> dict[str, float]:
        return {
            "left": round(self.left, 5),
            "top": round(self.top, 5),
            "width": round(self.width, 5),
            "height": round(self.height, 5),
        }


@dataclass(frozen=True)
class TrackPoint:
    frame_index: int
    box: NormalizedBox


@dataclass(frozen=True)
class DetectedObject:
    label: str
    category: str
    confidence: float
    box: NormalizedBox
    start_seconds: float
    end_seconds: float
    quality: str
    tracks: tuple[TrackPoint, ...] = field(default_factory=tuple)


@dataclass(frozen=True)
class Scene:
    start_seconds: float
    end_seconds: float
    objects: tuple[DetectedObject, ...]


@dataclass(frozen=True)
class AnalysisResult:
    scenes: tuple[Scene, ...]
