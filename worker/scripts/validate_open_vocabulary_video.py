from __future__ import annotations

import json
import sys
from pathlib import Path

import cv2

from framr_worker.live import LiveAnalyzer
from framr_worker.models import VideoMetadata


def main() -> int:
    if len(sys.argv) != 2:
        raise SystemExit("Usage: validate_open_vocabulary_video.py <source-video>")
    source = Path(sys.argv[1])
    capture = cv2.VideoCapture(str(source))
    fps = float(capture.get(cv2.CAP_PROP_FPS) or 30.0)
    frame_count = int(capture.get(cv2.CAP_PROP_FRAME_COUNT))
    width = int(capture.get(cv2.CAP_PROP_FRAME_WIDTH))
    height = int(capture.get(cv2.CAP_PROP_FRAME_HEIGHT))
    capture.release()
    metadata = VideoMetadata(
        duration_seconds=frame_count / fps,
        width=width,
        height=height,
        codec_name="h264",
        frame_rate=fps,
        frame_count=frame_count,
        has_audio=True,
    )
    analyzer = LiveAnalyzer(open_vocabulary_samples=24, open_vocabulary_device="mps")
    objects = analyzer._open_vocabulary_objects(source, metadata, existing=[])
    print(json.dumps([
        {
            "label": item.label,
            "confidence": item.confidence,
            "start_seconds": round(item.start_seconds, 2),
            "end_seconds": round(item.end_seconds, 2),
            "box": item.box.as_dict(),
        }
        for item in objects
    ], indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
