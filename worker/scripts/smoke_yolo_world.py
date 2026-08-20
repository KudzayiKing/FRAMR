from __future__ import annotations

import json
import sys

import cv2
from ultralytics import YOLO

PROMPTS = [
    "cooking pot",
    "yellow cooking pot",
    "saucepan",
    "frying pan",
    "wok",
    "rice cooker",
    "coffee machine",
]


def main() -> int:
    if len(sys.argv) != 2:
        raise SystemExit("Usage: smoke_yolo_world.py <source-video>")
    capture = cv2.VideoCapture(sys.argv[1])
    total = int(capture.get(cv2.CAP_PROP_FRAME_COUNT))
    sample = max(0, total // 2)
    capture.set(cv2.CAP_PROP_POS_FRAMES, sample)
    ok, frame = capture.read()
    capture.release()
    if not ok or frame is None:
        raise RuntimeError("Could not read a representative source frame.")

    model = YOLO("yolov8s-world.pt")
    model.set_classes(PROMPTS)
    result = model.predict(frame, conf=0.15, verbose=False, device="mps")[0]
    boxes = result.boxes
    output = []
    if boxes is not None:
        for xyxy, confidence, class_id in zip(boxes.xyxy.cpu().tolist(), boxes.conf.cpu().tolist(), boxes.cls.int().cpu().tolist(), strict=True):
            output.append({"label": result.names[int(class_id)], "confidence": round(float(confidence), 3), "box": [round(float(value), 1) for value in xyxy]})
    print(json.dumps({"frame": sample, "detections": output}, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
