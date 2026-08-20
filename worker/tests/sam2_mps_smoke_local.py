from __future__ import annotations

import shutil
from pathlib import Path

import cv2
import numpy as np

from framr_worker.frame_providers import SegmentationRequest
from framr_worker.sam2_provider import Sam2Configuration, Sam2VideoSegmentationProvider

root = Path("/tmp/framr-sam2-smoke")
shutil.rmtree(root, ignore_errors=True)
root.mkdir(parents=True)
video_path = root / "source.mp4"
writer = cv2.VideoWriter(str(video_path), cv2.VideoWriter_fourcc(*"mp4v"), 6.0, (192, 320))
if not writer.isOpened():
    raise RuntimeError("Could not create synthetic test video.")
for index in range(4):
    frame = np.zeros((320, 192, 3), dtype=np.uint8)
    left = 48 + index * 6
    cv2.rectangle(frame, (left, 120), (left + 58, 205), (255, 255, 255), -1)
    writer.write(frame)
writer.release()

provider = Sam2VideoSegmentationProvider(
    Sam2Configuration(
        checkpoint=Path("/Users/kudzayi/Developer/FRAMR/worker/models/sam2.1_hiera_tiny.pt"),
        device="mps",
    )
)
result = provider.segment_and_track(
    SegmentationRequest(
        source_path=video_path,
        seed_frame=1,
        prompt_bbox={"left": 0.25, "top": 0.35, "width": 0.35, "height": 0.35},
        prompt_mask_key=None,
        prompt_mask_path=None,
        output_directory=root / "masks",
    )
)
print(f"device=mps masks={len(result.mask_paths)}")
for path in result.mask_paths:
    print(path.name, path.stat().st_size)
