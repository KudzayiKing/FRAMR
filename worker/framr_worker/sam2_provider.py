from __future__ import annotations

import contextlib
from dataclasses import dataclass
from pathlib import Path
from typing import Iterator

from .frame_providers import SegmentationRequest, SegmentationResult
from .frame_types import ProviderUnavailable


@dataclass(frozen=True)
class Sam2Configuration:
    checkpoint: Path
    model_config: str = "configs/sam2.1/sam2.1_hiera_t.yaml"
    device: str = "auto"


class Sam2VideoSegmentationProvider:
    """Official SAM 2.1 adapter for promptable video masklets.

    The provider operates only on the source video and a creator-approved prompt
    (a refined PNG mask or the detected normalized box). It creates one PNG mask
    per tracked frame; it never modifies source pixels or generates imagery.
    """

    name = "sam2"

    def __init__(self, configuration: Sam2Configuration) -> None:
        self.configuration = configuration
        self.model = configuration.model_config

    def segment_and_track(self, request: SegmentationRequest) -> SegmentationResult:
        if not self.configuration.checkpoint.exists():
            raise ProviderUnavailable(
                f"SAM 2.1 checkpoint is unavailable at {self.configuration.checkpoint}. Configure FRAMR_SAM2_CHECKPOINT before tracking."
            )
        if not request.source_path.exists():
            raise ProviderUnavailable("The source video is unavailable for SAM 2.1 tracking.")
        if request.prompt_mask_path is None and request.prompt_bbox is None:
            raise ProviderUnavailable("SAM 2.1 requires a creator-refined mask or a placement bounding box prompt.")

        try:
            import cv2
            import numpy as np
            import torch
            from sam2.build_sam import build_sam2_video_predictor
        except ImportError as error:
            raise ProviderUnavailable("SAM 2.1 is not installed in the frame worker environment.") from error

        device = self._resolve_device(torch)
        predictor = build_sam2_video_predictor(
            self.configuration.model_config,
            str(self.configuration.checkpoint),
            device=device,
        )
        request.output_directory.mkdir(parents=True, exist_ok=True)
        # Passing MP4 directly makes SAM 2 import optional `decord`, which has no
        # Python 3.14 distribution on this local runtime. Its documented image
        # directory input path is deterministic and keeps FRAMR's own FFmpeg/OpenCV
        # stack in control of source decoding.
        # Automatic preparation is intentionally bounded to the creator-approved
        # placement interval. SAM 2 otherwise tracks every source frame, including
        # minutes where the selected product is not visible, which blocks the
        # single local worker and makes the workspace appear stuck.
        frames_directory = request.output_directory.parent / "sam2-input-frames-bounded"
        source_frame_indices = self._extract_tracking_frames(
            cv2,
            request.source_path,
            frames_directory,
            seed_frame=request.seed_frame,
            start_frame=request.start_frame,
            end_frame=request.end_frame,
            max_frames=request.max_tracking_frames,
        )
        try:
            seed_input_index = source_frame_indices.index(request.seed_frame)
        except ValueError as error:
            raise ProviderUnavailable("SAM 2.1 could not prepare the selected seed frame.") from error
        inference_state = predictor.init_state(str(frames_directory), offload_video_to_cpu=True, offload_state_to_cpu=True)

        with torch.inference_mode(), self._autocast(torch, device):
            if request.prompt_mask_path is not None:
                seed_mask = cv2.imread(str(request.prompt_mask_path), cv2.IMREAD_GRAYSCALE)
                if seed_mask is None:
                    raise ProviderUnavailable("The creator-refined seed mask could not be read by SAM 2.1.")
                _, _, mask_logits = predictor.add_new_mask(
                    inference_state,
                    frame_idx=seed_input_index,
                    obj_id=1,
                    mask=(seed_mask > 0),
                )
            else:
                frame_width, frame_height = self._video_size(cv2, request.source_path)
                box = self._absolute_box(np, request.prompt_bbox or {}, frame_width, frame_height)
                _, _, mask_logits = predictor.add_new_points_or_box(
                    inference_state,
                    frame_idx=seed_input_index,
                    obj_id=1,
                    box=box,
                )

            output_paths: list[Path] = []
            self._write_mask(cv2, mask_logits, request.seed_frame, request.output_directory, output_paths)
            forward_count = len(source_frame_indices) - seed_input_index - 1
            if forward_count:
                for frame_index, _object_ids, propagated_logits in predictor.propagate_in_video(
                    inference_state,
                    start_frame_idx=seed_input_index,
                    max_frame_num_to_track=forward_count,
                ):
                    self._write_mask(cv2, propagated_logits, source_frame_indices[int(frame_index)], request.output_directory, output_paths)
            backward_count = seed_input_index
            if backward_count:
                for frame_index, _object_ids, propagated_logits in predictor.propagate_in_video(
                    inference_state,
                    start_frame_idx=seed_input_index,
                    max_frame_num_to_track=backward_count,
                    reverse=True,
                ):
                    self._write_mask(cv2, propagated_logits, source_frame_indices[int(frame_index)], request.output_directory, output_paths)

        unique_paths = tuple(sorted(set(output_paths)))
        if not unique_paths:
            raise ProviderUnavailable("SAM 2.1 returned no trackable masklets for the selected target.")
        transition_frames = self._infer_transition_frames(cv2, unique_paths)
        return SegmentationResult(
            mask_paths=unique_paths,
            average_confidence=1.0,
            has_occlusion=bool(transition_frames),
            occluded_frame_indices=transition_frames,
        )

    def _resolve_device(self, torch_module: object) -> str:
        configured = self.configuration.device.lower().strip()
        if configured != "auto":
            return configured
        if bool(getattr(torch_module.cuda, "is_available")()):
            return "cuda"
        mps = getattr(getattr(torch_module, "backends", None), "mps", None)
        if mps is not None and bool(mps.is_available()):
            return "mps"
        return "cpu"

    @staticmethod
    def _autocast(torch_module: object, device: str) -> Iterator[None]:
        if device == "cuda":
            return torch_module.autocast("cuda", dtype=torch_module.bfloat16)  # type: ignore[no-any-return]
        return contextlib.nullcontext()

    @staticmethod
    def _extract_tracking_frames(
        cv2_module: object,
        source_path: Path,
        frames_directory: Path,
        *,
        seed_frame: int,
        start_frame: int | None,
        end_frame: int | None,
        max_frames: int | None,
    ) -> tuple[int, ...]:
        capture = cv2_module.VideoCapture(str(source_path))
        try:
            frame_count = int(capture.get(cv2_module.CAP_PROP_FRAME_COUNT))
            if frame_count <= 0:
                raise ProviderUnavailable("The source video has no decodable frames for SAM 2.1.")
            start = max(0, min(start_frame if start_frame is not None else 0, frame_count - 1))
            requested_end = max(start, min(end_frame if end_frame is not None else frame_count - 1, frame_count - 1))
            # Some mobile MP4s report one or more frames beyond the final decodable
            # frame. Resolve the usable tail before sampling so full-shot tracking
            # cannot become stuck on an invalid metadata-only frame.
            end = Sam2VideoSegmentationProvider._last_decodable_frame(
                cv2_module,
                capture,
                start=start,
                requested_end=requested_end,
            )
            seed = max(start, min(seed_frame, end))
            indices = Sam2VideoSegmentationProvider._sample_indices(start, end, seed, max_frames)
            existing = tuple(int(path.stem) for path in sorted(frames_directory.glob("*.jpg"))) if frames_directory.exists() else ()
            if existing == indices:
                return indices
            frames_directory.mkdir(parents=True, exist_ok=True)
            for path in frames_directory.glob("*.jpg"):
                path.unlink()
            for index in indices:
                capture.set(cv2_module.CAP_PROP_POS_FRAMES, index)
                ok, frame = capture.read()
                if not ok:
                    raise ProviderUnavailable(f"Could not prepare source frame {index} for SAM 2.1.")
                destination = frames_directory / f"{index:06d}.jpg"
                if not cv2_module.imwrite(str(destination), frame, [cv2_module.IMWRITE_JPEG_QUALITY, 95]):
                    raise ProviderUnavailable(f"Could not prepare source frame {index} for SAM 2.1.")
            return indices
        finally:
            capture.release()

    @staticmethod
    def _last_decodable_frame(cv2_module: object, capture: object, *, start: int, requested_end: int) -> int:
        for frame_index in range(requested_end, start - 1, -1):
            capture.set(cv2_module.CAP_PROP_POS_FRAMES, frame_index)
            readable, _frame = capture.read()
            if readable:
                return frame_index
        raise ProviderUnavailable("The selected source interval has no decodable frames for SAM 2.1.")

    @staticmethod
    def _sample_indices(start: int, end: int, seed: int, max_frames: int | None) -> tuple[int, ...]:
        available = end - start + 1
        limit = max(2, max_frames or available)
        if available <= limit:
            return tuple(range(start, end + 1))
        sampled = {round(start + (end - start) * position / (limit - 1)) for position in range(limit)}
        if seed not in sampled:
            nearest = min(sampled, key=lambda frame: abs(frame - seed))
            sampled.remove(nearest)
            sampled.add(seed)
        return tuple(sorted(sampled))

    @staticmethod
    def _video_size(cv2_module: object, source_path: Path) -> tuple[int, int]:
        capture = cv2_module.VideoCapture(str(source_path))
        try:
            width = int(capture.get(cv2_module.CAP_PROP_FRAME_WIDTH))
            height = int(capture.get(cv2_module.CAP_PROP_FRAME_HEIGHT))
        finally:
            capture.release()
        if width <= 0 or height <= 0:
            raise ProviderUnavailable("The source video has no readable frame geometry for SAM 2.1.")
        return width, height

    @staticmethod
    def _absolute_box(np_module: object, box: dict[str, float], width: int, height: int):
        left = max(0.0, min(1.0, float(box.get("left", 0.0))))
        top = max(0.0, min(1.0, float(box.get("top", 0.0))))
        right = max(left, min(1.0, left + float(box.get("width", 0.0))))
        bottom = max(top, min(1.0, top + float(box.get("height", 0.0))))
        if right <= left or bottom <= top:
            raise ProviderUnavailable("The selected placement has an invalid bounding-box prompt.")
        return np_module.array([left * width, top * height, right * width, bottom * height], dtype=np_module.float32)

    @staticmethod
    def _infer_transition_frames(cv2_module: object, mask_paths: tuple[Path, ...]) -> tuple[int, ...]:
        """Infer safe state-change candidates from sparse, tracked mask geometry.

        SAM 2 tracks the pot as one object but does not emit an occlusion label.
        A large, sustained change in its mask area is a reliable signal that a hand
        or the lid has changed what is visibly part of that object. These frames
        are stored in the existing per-mask continuity flag and are only used to
        split a Lucy edit when both closed and open reference images exist.
        """
        samples: list[tuple[int, int]] = []
        for path in sorted(mask_paths):
            mask = cv2_module.imread(str(path), cv2_module.IMREAD_GRAYSCALE)
            if mask is None:
                continue
            frame_token = path.stem.removeprefix("mask-")
            try:
                frame_index = int(frame_token)
            except ValueError:
                continue
            area = int((mask > 0).sum())
            samples.append((frame_index, area))
        if len(samples) < 3:
            return ()

        candidates: list[int] = []
        for index in range(1, len(samples) - 1):
            _previous_frame, previous_area = samples[index - 1]
            frame_index, current_area = samples[index]
            _next_frame, next_area = samples[index + 1]
            if previous_area <= 0 or current_area <= 0 or next_area <= 0:
                continue
            ratio = current_area / previous_area
            # A 30% size change is substantial enough to capture a hand/lid
            # transition while rejecting ordinary propagation jitter. Require the
            # next sparse sample to remain near the new size so a single noisy
            # masklet cannot create a costly extra Lucy window.
            large_change = ratio <= 0.70 or ratio >= 1.45
            next_ratio = next_area / current_area
            sustained = 0.70 <= next_ratio <= 1.45
            if large_change and sustained:
                candidates.append(frame_index)
        return tuple(candidates)

    @staticmethod
    def _write_mask(cv2_module: object, mask_logits: object, frame_index: int, output_directory: Path, paths: list[Path]) -> None:
        # SAM 2 returns different leading object/batch dimensions across predictor
        # releases. Preserve the pixel plane, not an accidental 3D tensor shape.
        logits = mask_logits.detach().to("cpu").squeeze().numpy()
        if logits.ndim != 2:
            raise ProviderUnavailable(f"SAM 2.1 returned an invalid mask shape for frame {frame_index}: {logits.shape}.")
        mask = (logits > 0).astype("uint8") * 255
        destination = output_directory / f"mask-{frame_index:06d}.png"
        if not cv2_module.imwrite(str(destination), mask):
            raise ProviderUnavailable(f"SAM 2.1 could not write mask frame {frame_index}.")
        paths.append(destination)
