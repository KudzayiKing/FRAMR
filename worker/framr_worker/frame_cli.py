from __future__ import annotations

import argparse
import logging
import sys
import time

from .frame_pipeline import FramePreservingPipeline
from .frame_repository import FrameRunRepository
from .frame_settings import FrameSettings
from .sam2_provider import Sam2Configuration, Sam2VideoSegmentationProvider
from .sam3_provider import Sam3Configuration, Sam3VideoSegmentationProvider
from .storage import ObjectStorage
from .target_pipeline import TargetPreparationPipeline
from .target_repository import TargetPreparationRepository


def build_pipelines(settings: FrameSettings) -> tuple[TargetPreparationPipeline, FramePreservingPipeline]:
    from supabase import create_client

    client = create_client(settings.supabase_url, settings.supabase_service_role_key)
    segmentation_provider = None
    if settings.segmentation_provider == "sam2":
        segmentation_provider = Sam2VideoSegmentationProvider(
            Sam2Configuration(
                checkpoint=settings.sam2_checkpoint,
                model_config=settings.sam2_model_config,
                device=settings.sam2_device,
            )
        )
    elif settings.segmentation_provider == "sam3":
        segmentation_provider = Sam3VideoSegmentationProvider(
            Sam3Configuration(
                checkpoint_directory=settings.sam3_checkpoint_directory,
                device=settings.sam3_device,
            )
        )
    localized_editor = None
    if settings.localized_editor == "nim":
        from .nim_provider import NimConfiguration, NimLocalizedImageEditor

        localized_editor = NimLocalizedImageEditor(
            NimConfiguration(
                api_key=settings.nvidia_api_key,
                model=settings.nim_model,
                timeout_seconds=settings.nim_timeout_seconds,
                steps=settings.nim_steps,
            )
        )
    # Gemini and FLUX provider implementations remain available but are not selected
    # during this NVIDIA NIM testing pass. Re-enable only after explicit provider review.
    storage = ObjectStorage(client)
    target_pipeline = TargetPreparationPipeline(
        repository=TargetPreparationRepository(client, worker_id=settings.worker_id, lease_seconds=settings.lease_seconds),
        storage=storage,
        work_dir=settings.work_dir,
        segmentation_provider=segmentation_provider,
    )
    run_pipeline = FramePreservingPipeline(
        repository=FrameRunRepository(client, worker_id=settings.worker_id, lease_seconds=settings.lease_seconds),
        storage=storage,
        work_dir=settings.work_dir,
        segmentation_provider=segmentation_provider,
        localized_editor=localized_editor,
    )
    return target_pipeline, run_pipeline


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Process FRAMR automatic targets and protected placement stages.")
    parser.add_argument("--once", action="store_true", help="Process at most one automatic target or placement stage, then exit.")
    return parser.parse_args()


def main() -> int:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s %(message)s")
    args = parse_args()
    try:
        settings = FrameSettings.from_environment()
        target_pipeline, run_pipeline = build_pipelines(settings)
    except Exception as error:
        logging.error("frame_worker_configuration_error: %s", error)
        return 2

    def process_one() -> bool:
        # Preparing the selected object before product work prevents a creator from
        # waiting on segmentation after choosing a campaign asset.
        return target_pipeline.process_next() or run_pipeline.process_next()

    if args.once:
        process_one()
        return 0
    logging.info("frame_worker_started worker_id=%s poll_seconds=%s", settings.worker_id, settings.poll_seconds)
    while True:
        try:
            if not process_one():
                time.sleep(settings.poll_seconds)
        except KeyboardInterrupt:
            logging.info("frame_worker_stopped")
            return 0
        except Exception:
            logging.exception("frame_worker_loop_error")
            time.sleep(settings.poll_seconds)


if __name__ == "__main__":
    sys.exit(main())
