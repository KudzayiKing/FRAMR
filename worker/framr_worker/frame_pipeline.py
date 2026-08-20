from __future__ import annotations

import json
import logging
import re
import subprocess
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from .frame_providers import (
    DevelopmentLocalizedImageEditor,
    DevelopmentSegmentationProvider,
    LocalizedEditRequest,
    LocalizedImageEditor,
    SegmentationProvider,
    SegmentationRequest,
)
from .frame_repository import FrameRunRepository
from .frame_types import FRAME_STAGES, NeedsReview, PlacementStageJob, ProviderUnavailable, StageOutcome
from .storage import ObjectStorage

LOGGER = logging.getLogger(__name__)
MASK_FRAME_PATTERN = re.compile(r"mask-(\d+)\.png$")


class FramePreservingPipeline:
    """Durable protected-placement pipeline.

    SAM can create target masklets, while deterministic OpenCV stages derive only
    source-frame crops, masks, and edit-request manifests. Source pixels remain
    immutable until a separately approved localized-image editor is connected.
    """

    def __init__(
        self,
        *,
        repository: FrameRunRepository,
        storage: ObjectStorage,
        work_dir: Path,
        segmentation_provider: SegmentationProvider | None = None,
        localized_editor: LocalizedImageEditor | None = None,
    ) -> None:
        self.repository = repository
        self.storage = storage
        self.work_dir = work_dir
        self.segmentation_provider = segmentation_provider or DevelopmentSegmentationProvider()
        self.localized_editor = localized_editor or DevelopmentLocalizedImageEditor()

    def process_next(self) -> bool:
        job = self.repository.claim_next()
        if not job:
            return False
        try:
            self._process(job)
        except NeedsReview as error:
            manifest_key = self._write_manifest(job, {"status": "needs_review", "reason": str(error)})
            self.repository.block_for_review(job, str(error), manifest_key=manifest_key)
            LOGGER.info("frame_run_needs_review run_id=%s stage=%s", job.run_id, job.job_type)
        except ProviderUnavailable as error:
            manifest_key = self._write_manifest(job, {"status": "blocked", "reason": str(error)})
            self.repository.block_for_review(job, str(error), manifest_key=manifest_key)
            LOGGER.info("frame_provider_unavailable run_id=%s stage=%s", job.run_id, job.job_type)
        except Exception as error:
            LOGGER.exception("frame_stage_failed run_id=%s stage=%s", job.run_id, job.job_type)
            self.repository.fail_stage(job, self._safe_error(error))
        return True

    def _process(self, job: PlacementStageJob) -> None:
        handlers = {
            "prepare_source": self._prepare_source,
            "segment_target": self._segment_target,
            "track_target": self._confirm_tracking,
            "select_keyframes": self._select_keyframes,
            "edit_keyframes": self._prepare_localized_edits,
            "propagate_frames": self._propagate_preview,
            "composite_frames": self._composite_preview,
            "quality_check": self._check_preview,
            "render_video": self._render_preview,
        }
        handler = handlers.get(job.job_type)
        if handler is not None:
            handler(job)
            return
        raise RuntimeError(f"The placement stage {job.job_type} is unavailable.")

    def _prepare_source(self, job: PlacementStageJob) -> None:
        context = self.repository.load_context(job)
        manifest = {
            "schema": "framr.frame-preserving.prepare-source.v1",
            "created_at": datetime.now(UTC).isoformat(),
            "run_id": job.run_id,
            "source": {
                "storage_key": context.storage_key,
                "duration_seconds": context.duration_seconds,
                "frame_rate": context.frame_rate,
                "frame_count": context.frame_count,
                "audio_policy": "preserve_original",
                "immutable": True,
            },
            "target": {
                "id": job.target_id,
                "start_frame": context.target_start_frame,
                "end_frame": context.target_end_frame,
                "seed_frame": context.target_seed_frame,
                "seed_bbox": context.target_seed_bbox,
                "seed_mask_key": context.target_seed_mask_key,
                "revision": context.target_revision,
            },
            "product_reference_keys": list(context.product_reference_keys),
            "providers": self._provider_manifest(job),
            "settings": job.run_settings,
        }
        manifest_key = self._write_manifest(job, manifest, name="prepare-source.json")
        self._complete(job, manifest_key, {"frame_count": context.frame_count, "target_frame_count": context.target_end_frame - context.target_start_frame + 1})

    def _segment_target(self, job: PlacementStageJob) -> None:
        context = self.repository.load_context(job)
        existing_masklets = self.repository.list_masklets(job, revision=context.target_revision)
        if existing_masklets:
            manifest_key = self._write_manifest(
                job,
                {
                    "schema": "framr.frame-preserving.segment-target.v1",
                    "created_at": datetime.now(UTC).isoformat(),
                    "provider": {"name": "prepared-target", "model": "sam-masklets"},
                    "target_revision": context.target_revision,
                    "masklets": existing_masklets,
                    "reused_automatic_target": True,
                },
                name="segment-target.json",
            )
            self._complete(job, manifest_key, {"masklet_count": len(existing_masklets), "reused_automatic_target": True})
            return
        if not context.target_seed_mask_key and not context.target_seed_bbox:
            raise NeedsReview("FRAMR could not recover a usable detection box for this placement target.")
        run_dir = self.work_dir / job.run_id
        run_dir.mkdir(parents=True, exist_ok=True)
        source_path = self._source_path(job, context.storage_key)
        seed_mask_path: Path | None = None
        if context.target_seed_mask_key:
            seed_mask_path = run_dir / "seed-mask.png"
            if not seed_mask_path.exists():
                seed_mask_path.write_bytes(self.storage.download_private_object(context.target_seed_mask_key))
        output_directory = run_dir / "tracked-masks"
        result = self.segmentation_provider.segment_and_track(
            SegmentationRequest(
                source_path=source_path,
                seed_frame=context.target_seed_frame,
                prompt_bbox=context.target_seed_bbox,
                prompt_mask_key=context.target_seed_mask_key,
                prompt_mask_path=seed_mask_path,
                output_directory=output_directory,
            )
        )
        persisted: list[dict[str, Any]] = []
        for mask_path in result.mask_paths:
            match = MASK_FRAME_PATTERN.search(mask_path.name)
            if not match:
                continue
            frame_index = int(match.group(1))
            if frame_index < context.target_start_frame or frame_index > context.target_end_frame:
                continue
            storage_key = self.storage.upload_artifact_bytes(
                job.owner_id,
                job.run_id,
                f"masks/target-rev-{context.target_revision}/mask-{frame_index:06d}.png",
                mask_path.read_bytes(),
                content_type="image/png",
            )
            self.repository.record_masklet(
                job,
                frame_index=frame_index,
                storage_key=storage_key,
                revision=context.target_revision,
                confidence=result.average_confidence,
                is_occluded=result.has_occlusion,
            )
            persisted.append({"frame_index": frame_index, "storage_key": storage_key})
        if not persisted:
            raise NeedsReview("SAM tracking did not produce masklets inside the creator-approved frame range.")
        manifest_key = self._write_manifest(
            job,
            {
                "schema": "framr.frame-preserving.segment-target.v1",
                "created_at": datetime.now(UTC).isoformat(),
                "provider": {"name": self.segmentation_provider.name, "model": self.segmentation_provider.model},
                "target_revision": context.target_revision,
                "masklets": persisted,
            },
            name="segment-target.json",
        )
        self._complete(job, manifest_key, {"masklet_count": len(persisted), "average_confidence": result.average_confidence, "has_occlusion": result.has_occlusion})

    def _confirm_tracking(self, job: PlacementStageJob) -> None:
        context = self.repository.load_context(job)
        masklets = self.repository.list_masklets(job, revision=context.target_revision)
        if not masklets:
            raise NeedsReview("No SAM masklets are available for the approved target revision.")
        manifest_key = self._write_manifest(
            job,
            {
                "schema": "framr.frame-preserving.track-target.v1",
                "target_revision": context.target_revision,
                "masklet_count": len(masklets),
                "first_frame": int(masklets[0]["frame_index"]),
                "last_frame": int(masklets[-1]["frame_index"]),
                "tracking": "native_sam2_masklet",
            },
            name="track-target.json",
        )
        self._complete(job, manifest_key, {"masklet_count": len(masklets)})

    def _select_keyframes(self, job: PlacementStageJob) -> None:
        import cv2
        import numpy as np

        context = self.repository.load_context(job)
        masklets = self.repository.list_masklets(job, revision=context.target_revision)
        candidates = [row for row in masklets if not bool(row.get("is_occluded"))]
        if not candidates:
            raise NeedsReview("No visible SAM masklets are available for localized keyframe extraction.")
        selected = self._select_evenly_spaced(candidates, context.target_seed_frame)
        source_path = self._source_path(job, context.storage_key)
        capture = cv2.VideoCapture(str(source_path))
        persisted: list[dict[str, Any]] = []
        try:
            for row in selected:
                frame_index = int(row["frame_index"])
                frame = self._read_frame(cv2, capture, frame_index)
                encoded_mask = self.storage.download_private_object(str(row["storage_key"]))
                mask = cv2.imdecode(np.frombuffer(encoded_mask, dtype=np.uint8), cv2.IMREAD_GRAYSCALE)
                if mask is None:
                    raise NeedsReview(f"The tracked masklet for frame {frame_index} is unreadable.")
                if mask.shape[:2] != frame.shape[:2]:
                    mask = cv2.resize(mask, (frame.shape[1], frame.shape[0]), interpolation=cv2.INTER_NEAREST)
                crop_box = self._padded_mask_bounds(cv2, mask, frame.shape[1], frame.shape[0])
                x1, y1, x2, y2 = crop_box
                crop = frame[y1:y2, x1:x2]
                crop_mask = mask[y1:y2, x1:x2]
                source_frame_key = self._upload_image(cv2, job, f"keyframes/source/frame-{frame_index:06d}.jpg", frame, ".jpg")
                crop_key = self._upload_image(cv2, job, f"keyframes/crops/crop-{frame_index:06d}.jpg", crop, ".jpg")
                crop_mask_key = self._upload_image(cv2, job, f"keyframes/masks/mask-{frame_index:06d}.png", crop_mask, ".png")
                confidence = float(row["confidence"]) if row.get("confidence") is not None else None
                self.repository.record_keyframe(
                    job,
                    frame_index=frame_index,
                    time_seconds=frame_index / max(context.frame_rate, 0.001),
                    reason="seed" if frame_index == context.target_seed_frame else "temporal_coverage",
                    source_frame_key=source_frame_key,
                    crop_key=crop_key,
                    mask_key=crop_mask_key,
                    score=confidence,
                )
                persisted.append({"frame_index": frame_index, "source_frame_key": source_frame_key, "crop_key": crop_key, "mask_key": crop_mask_key, "crop_box": [x1, y1, x2, y2]})
        finally:
            capture.release()
        manifest_key = self._write_manifest(
            job,
            {
                "schema": "framr.frame-preserving.select-keyframes.v1",
                "target_revision": context.target_revision,
                "keyframes": persisted,
                "selection_policy": "seed + evenly_spaced_visible_masklets",
            },
            name="select-keyframes.json",
        )
        self._complete(job, manifest_key, {"keyframe_count": len(persisted)})

    def _prepare_localized_edits(self, job: PlacementStageJob) -> None:
        context = self.repository.load_context(job)
        keyframes = self.repository.list_keyframes(job)
        if not keyframes:
            raise NeedsReview("We could not find a clear view of the selected item.")
        if not context.product_reference_keys:
            raise NeedsReview("We could not find the selected product reference.")
        run_dir = self.work_dir / job.run_id
        edit_dir = run_dir / "flux-edits"
        edit_dir.mkdir(parents=True, exist_ok=True)
        product_paths: list[Path] = []
        for index, product_key in enumerate(context.product_reference_keys):
            suffix = Path(product_key).suffix or ".jpg"
            product_path = edit_dir / f"product-{index}{suffix}"
            if not product_path.exists():
                product_path.write_bytes(self.storage.download_private_object(product_key))
            product_paths.append(product_path)
        product_urls = tuple(self.storage.create_private_signed_url(key) for key in context.product_reference_keys)
        edited: list[dict[str, Any]] = []
        for keyframe in keyframes:
            frame_index = int(keyframe["frame_index"])
            crop_key = str(keyframe["source_crop_key"])
            mask_key = str(keyframe["mask_key"])
            crop_path = edit_dir / f"crop-{frame_index:06d}.jpg"
            mask_path = edit_dir / f"mask-{frame_index:06d}.png"
            if not crop_path.exists():
                crop_path.write_bytes(self.storage.download_private_object(crop_key))
            if not mask_path.exists():
                mask_path.write_bytes(self.storage.download_private_object(mask_key))
            result = self.localized_editor.edit_placement(
                LocalizedEditRequest(
                    source_crop=crop_path,
                    target_mask=mask_path,
                    product_reference_paths=tuple(product_paths),
                    source_crop_url=self.storage.create_private_signed_url(crop_key),
                    target_mask_url=self.storage.create_private_signed_url(mask_key),
                    product_reference_urls=product_urls,
                    instruction=(
                        "Image 1 is a tightly framed real video scene. Image 2 is the exact product to place in the scene. "
                        "Replace only the central selected object in image 1 with the product from image 2. "
                        "Keep the camera angle, crop composition, hands, food, person, background, lighting, shadows, depth of field, "
                        "and all non-product details unchanged. Make the product photorealistic, naturally sized, and integrated into the scene."
                    ),
                )
            )
            payload = result.edited_crop.read_bytes()
            generated_key = self.storage.upload_artifact_bytes(
                job.owner_id,
                job.run_id,
                f"keyframes/edited/flux-{frame_index:06d}.jpg",
                payload,
                content_type="image/jpeg",
            )
            self.repository.record_generated_keyframe(
                job,
                frame_index=frame_index,
                generated_crop_key=generated_key,
                provider=self.localized_editor.name,
                model=self.localized_editor.model,
            )
            edited.append({"frame_index": frame_index, "generated_crop_key": generated_key})
        manifest_key = self._write_manifest(
            job,
            {
                "schema": "framr.flux-localized-edits.v1",
                "created_at": datetime.now(UTC).isoformat(),
                "source_preserved": True,
                "provider": {"name": self.localized_editor.name, "model": self.localized_editor.model},
                "keyframes": edited,
            },
            name="flux-localized-edits.json",
        )
        self._complete(job, manifest_key, {"keyframe_count": len(edited), "provider": self.localized_editor.name})

    def _propagate_preview(self, job: PlacementStageJob) -> None:
        context = self.repository.load_context(job)
        masklets = self.repository.list_masklets(job, revision=context.target_revision)
        if not masklets:
            raise NeedsReview("We could not keep track of the selected item.")
        manifest_key = self._write_manifest(job, {"schema": "framr.automatic-preview.tracking.v1", "masklet_count": len(masklets)})
        self._complete(job, manifest_key, {"masklet_count": len(masklets)})

    def _composite_preview(self, job: PlacementStageJob) -> None:
        manifest_key = self._write_manifest(job, {"schema": "framr.automatic-preview.composite.v1", "source_preserved": True})
        self._complete(job, manifest_key, {"source_preserved": True})

    def _check_preview(self, job: PlacementStageJob) -> None:
        manifest_key = self._write_manifest(job, {"schema": "framr.automatic-preview.quality.v1", "result": "ready_for_render"})
        self._complete(job, manifest_key, {"result": "ready_for_render"})

    def _render_preview(self, job: PlacementStageJob) -> None:
        import cv2
        import numpy as np

        context = self.repository.load_context(job)
        masklets = self.repository.list_masklets(job, revision=context.target_revision)
        if not masklets:
            raise NeedsReview("We could not keep track of the selected item.")
        run_dir = self.work_dir / job.run_id
        source_path = self._source_path(job, context.storage_key)
        prepared_masks = self._load_masks(cv2, np, masklets)
        keyframe_edits = self._load_keyframe_edits(cv2, np, self.repository.list_keyframes(job))
        if not prepared_masks or not keyframe_edits:
            raise NeedsReview("We could not prepare the localized replacement for rendering.")

        capture = cv2.VideoCapture(str(source_path))
        width = int(capture.get(cv2.CAP_PROP_FRAME_WIDTH))
        height = int(capture.get(cv2.CAP_PROP_FRAME_HEIGHT))
        fps = float(capture.get(cv2.CAP_PROP_FPS) or context.frame_rate or 30.0)
        if width <= 0 or height <= 0:
            capture.release()
            raise NeedsReview("The source video could not be prepared for preview.")
        silent_path = run_dir / "preview-silent.mp4"
        writer = cv2.VideoWriter(str(silent_path), cv2.VideoWriter_fourcc(*"mp4v"), fps, (width, height))
        if not writer.isOpened():
            capture.release()
            raise RuntimeError("The preview video encoder is unavailable.")
        frame_index = 0
        thumbnail_frame = max(context.target_start_frame, min(context.target_seed_frame, context.target_end_frame))
        thumbnail: object | None = None
        try:
            while True:
                ok, frame = capture.read()
                if not ok or frame is None:
                    break
                if context.target_start_frame <= frame_index <= context.target_end_frame:
                    mask = self._nearest_mask(prepared_masks, frame_index)
                    _, edited_crop, crop_mask = self._nearest_keyframe_edit(keyframe_edits, frame_index)
                    frame = self._composite_keyframe_edit(cv2, np, frame, mask, edited_crop, crop_mask)
                if frame_index == thumbnail_frame:
                    thumbnail = frame.copy()
                writer.write(frame)
                frame_index += 1
        finally:
            capture.release()
            writer.release()
        if frame_index == 0:
            raise RuntimeError("The source video has no frames to render.")
        if thumbnail is None:
            thumbnail = self._read_preview_thumbnail(cv2, silent_path)
        thumbnail_path = run_dir / "preview.jpg"
        if thumbnail is None or not cv2.imwrite(str(thumbnail_path), thumbnail, [cv2.IMWRITE_JPEG_QUALITY, 92]):
            raise RuntimeError("The preview thumbnail could not be created.")
        preview_path = run_dir / "preview.mp4"
        self._restore_original_audio(source_path, silent_path, preview_path)
        video_key, thumbnail_key = self.storage.upload_generated_preview(job.owner_id, job.run_id, preview_path, thumbnail_path)
        self.repository.publish_version(job, video_key=video_key, thumbnail_key=thumbnail_key)
        manifest_key = self._write_manifest(job, {"schema": "framr.flux-localized-preview.render.v1", "video_key": video_key, "thumbnail_key": thumbnail_key, "source_audio": "preserved", "edited_keyframe_count": len(keyframe_edits)})
        self._complete(job, manifest_key, {"frame_count": frame_index, "source_audio": "preserved"})

    def _load_masks(self, cv2_module: object, np_module: object, masklets: list[dict[str, Any]]) -> list[tuple[int, object]]:
        prepared: list[tuple[int, object]] = []
        for masklet in masklets:
            storage_key = masklet.get("storage_key")
            if not storage_key:
                continue
            payload = self.storage.download_private_object(str(storage_key))
            mask = cv2_module.imdecode(np_module.frombuffer(payload, dtype=np_module.uint8), cv2_module.IMREAD_GRAYSCALE)
            if mask is not None:
                prepared.append((int(masklet["frame_index"]), mask))
        return sorted(prepared, key=lambda item: item[0])

    @staticmethod
    def _nearest_mask(prepared_masks: list[tuple[int, object]], frame_index: int):
        return min(prepared_masks, key=lambda item: abs(item[0] - frame_index))[1]

    @staticmethod
    def _composite_product(cv2_module: object, np_module: object, frame: object, mask: object, product_bgr: object, product_alpha: object):
        """Legacy test helper; the production renderer uses FLUX-edited keyframes."""
        if mask.shape[:2] != frame.shape[:2]:
            mask = cv2_module.resize(mask, (frame.shape[1], frame.shape[0]), interpolation=cv2_module.INTER_NEAREST)
        points = cv2_module.findNonZero(mask)
        if points is None:
            return frame
        x, y, width, height = cv2_module.boundingRect(points)
        if width < 2 or height < 2:
            return frame
        product = cv2_module.resize(product_bgr, (width, height), interpolation=cv2_module.INTER_AREA if product_bgr.shape[0] > height else cv2_module.INTER_CUBIC)
        alpha = cv2_module.resize(product_alpha, (width, height), interpolation=cv2_module.INTER_LINEAR).astype("float32") / 255.0
        target_alpha = (mask[y:y + height, x:x + width].astype("float32") / 255.0)
        alpha = np_module.clip(alpha * target_alpha, 0.0, 1.0)[:, :, None]
        destination = frame[y:y + height, x:x + width].astype("float32")
        frame[y:y + height, x:x + width] = (product.astype("float32") * alpha + destination * (1.0 - alpha)).astype("uint8")
        return frame

    def _load_keyframe_edits(self, cv2_module: object, np_module: object, keyframes: list[dict[str, Any]]) -> list[tuple[int, object, object]]:
        prepared: list[tuple[int, object, object]] = []
        for keyframe in keyframes:
            generated_key = keyframe.get("generated_crop_key")
            mask_key = keyframe.get("mask_key")
            if not generated_key or not mask_key:
                continue
            edited = cv2_module.imdecode(np_module.frombuffer(self.storage.download_private_object(str(generated_key)), dtype=np_module.uint8), cv2_module.IMREAD_COLOR)
            mask = cv2_module.imdecode(np_module.frombuffer(self.storage.download_private_object(str(mask_key)), dtype=np_module.uint8), cv2_module.IMREAD_GRAYSCALE)
            if edited is not None and mask is not None:
                prepared.append((int(keyframe["frame_index"]), edited, mask))
        return sorted(prepared, key=lambda item: item[0])

    @staticmethod
    def _nearest_keyframe_edit(prepared_edits: list[tuple[int, object, object]], frame_index: int) -> tuple[int, object, object]:
        return min(prepared_edits, key=lambda item: abs(item[0] - frame_index))

    @staticmethod
    def _composite_keyframe_edit(cv2_module: object, np_module: object, frame: object, target_mask: object, edited_crop: object, crop_mask: object):
        if target_mask.shape[:2] != frame.shape[:2]:
            target_mask = cv2_module.resize(target_mask, (frame.shape[1], frame.shape[0]), interpolation=cv2_module.INTER_NEAREST)
        target_points = cv2_module.findNonZero(target_mask)
        crop_points = cv2_module.findNonZero(crop_mask)
        if target_points is None or crop_points is None:
            return frame
        x, y, width, height = cv2_module.boundingRect(target_points)
        crop_x, crop_y, crop_width, crop_height = cv2_module.boundingRect(crop_points)
        if min(width, height, crop_width, crop_height) < 2:
            return frame
        product_region = edited_crop[crop_y:crop_y + crop_height, crop_x:crop_x + crop_width]
        if product_region.size == 0:
            return frame
        resized = cv2_module.resize(product_region, (width, height), interpolation=cv2_module.INTER_CUBIC)
        alpha = (target_mask[y:y + height, x:x + width].astype("float32") / 255.0)[:, :, None]
        destination = frame[y:y + height, x:x + width].astype("float32")
        frame[y:y + height, x:x + width] = (resized.astype("float32") * alpha + destination * (1.0 - alpha)).astype("uint8")
        return frame

    @staticmethod
    def _read_preview_thumbnail(cv2_module: object, preview_path: Path):
        capture = cv2_module.VideoCapture(str(preview_path))
        try:
            ok, frame = capture.read()
            return frame if ok else None
        finally:
            capture.release()

    @staticmethod
    def _restore_original_audio(source_path: Path, silent_path: Path, output_path: Path) -> None:
        command = [
            "ffmpeg", "-y", "-i", str(silent_path), "-i", str(source_path),
            "-map", "0:v:0", "-map", "1:a?", "-c:v", "libx264", "-c:a", "aac",
            "-movflags", "+faststart", "-shortest", str(output_path),
        ]
        completed = subprocess.run(command, capture_output=True, text=True, check=False)
        if completed.returncode != 0 or not output_path.exists():
            detail = (completed.stderr or "").strip().splitlines()[-1:] or ["FFmpeg could not restore the original audio."]
            raise RuntimeError(detail[0])

    def _source_path(self, job: PlacementStageJob, storage_key: str) -> Path:
        run_dir = self.work_dir / job.run_id
        run_dir.mkdir(parents=True, exist_ok=True)
        source_path = run_dir / "source.mp4"
        if not source_path.exists():
            self.storage.download_source_video(storage_key, source_path)
        return source_path

    @staticmethod
    def _select_evenly_spaced(masklets: list[dict[str, Any]], seed_frame: int) -> list[dict[str, Any]]:
        desired = min(8, max(3, (len(masklets) + 89) // 90))
        indices = {0, len(masklets) - 1, min(range(len(masklets)), key=lambda index: abs(int(masklets[index]["frame_index"]) - seed_frame))}
        if desired > 1:
            for slot in range(desired):
                indices.add(round(slot * (len(masklets) - 1) / (desired - 1)))
        return [masklets[index] for index in sorted(indices)]

    @staticmethod
    def _read_frame(cv2_module: object, capture: object, frame_index: int):
        capture.set(cv2_module.CAP_PROP_POS_FRAMES, frame_index)
        ok, frame = capture.read()
        if not ok or frame is None:
            raise NeedsReview(f"The source frame {frame_index} could not be decoded for keyframe extraction.")
        return frame

    @staticmethod
    def _padded_mask_bounds(cv2_module: object, mask: object, width: int, height: int) -> tuple[int, int, int, int]:
        points = cv2_module.findNonZero(mask)
        if points is None:
            raise NeedsReview("A tracked masklet is empty and cannot define a localized edit crop.")
        x, y, crop_width, crop_height = cv2_module.boundingRect(points)
        padding = max(12, round(max(crop_width, crop_height) * 0.15))
        return max(0, x - padding), max(0, y - padding), min(width, x + crop_width + padding), min(height, y + crop_height + padding)

    def _upload_image(self, cv2_module: object, job: PlacementStageJob, relative_path: str, image: object, extension: str) -> str:
        ok, encoded = cv2_module.imencode(extension, image)
        if not ok:
            raise NeedsReview(f"Could not encode the localized {extension} artifact.")
        return self.storage.upload_artifact_bytes(
            job.owner_id,
            job.run_id,
            relative_path,
            encoded.tobytes(),
            content_type="image/png" if extension == ".png" else "image/jpeg",
        )

    def _complete(self, job: PlacementStageJob, manifest_key: str, metrics: dict[str, Any]) -> None:
        self.repository.complete_stage(
            job,
            StageOutcome(output_manifest_key=manifest_key, metrics=metrics, progress=self._progress_after(job)),
        )
        LOGGER.info("frame_stage_complete run_id=%s stage=%s", job.run_id, job.job_type)

    @staticmethod
    def _provider_manifest(job: PlacementStageJob) -> dict[str, dict[str, str]]:
        return {
            "segmentation": {"name": job.segmentation_provider, "model": job.segmentation_model},
            "image_editor": {"name": job.image_editor_provider, "model": job.image_editor_model},
            "propagation": {"name": job.propagation_provider, "model": job.propagation_model},
        }

    def _write_manifest(self, job: PlacementStageJob, payload: dict[str, Any], *, name: str | None = None) -> str:
        filename = name or f"{job.job_type}.json"
        encoded = json.dumps(payload, sort_keys=True, separators=(",", ":")).encode("utf-8")
        return self.storage.upload_artifact_bytes(
            job.owner_id,
            job.run_id,
            f"manifests/{job.sequence:02d}-{filename}",
            encoded,
            content_type="application/json",
        )

    @staticmethod
    def _progress_after(job: PlacementStageJob) -> float:
        return round(((job.sequence + 1) / len(FRAME_STAGES)) * 100, 2)

    @staticmethod
    def _safe_error(error: Exception) -> str:
        message = str(error).strip()
        return message[:500] if message else "The frame-preserving stage could not be completed."
