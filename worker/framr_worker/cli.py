from __future__ import annotations

import argparse
import logging
import sys
import time

from .media import MediaProcessor
from .mock import MockAnalyzer
from .pipeline import AnalysisPipeline
from .repository import AnalysisRepository
from .settings import Settings
from .storage import ObjectStorage


def build_pipeline(settings: Settings) -> AnalysisPipeline:
    from supabase import create_client

    client = create_client(settings.supabase_url, settings.supabase_service_role_key)
    if settings.analysis_mode == "mock":
        analyzer = MockAnalyzer()
    else:
        from .live import LiveAnalyzer
        analyzer = LiveAnalyzer(
            model_name=settings.yolo_model,
            tracker_config=settings.tracker_config,
            open_vocabulary_enabled=settings.open_vocabulary_enabled,
            open_vocabulary_model=settings.open_vocabulary_model,
            open_vocabulary_confidence=settings.open_vocabulary_confidence,
            open_vocabulary_samples=settings.open_vocabulary_samples,
            open_vocabulary_device=settings.open_vocabulary_device,
        )
    return AnalysisPipeline(
        settings=settings,
        repository=AnalysisRepository(client),
        storage=ObjectStorage(client),
        media=MediaProcessor(ffmpeg_bin=settings.ffmpeg_bin, ffprobe_bin=settings.ffprobe_bin),
        analyzer=analyzer,
    )


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Process FRAMR uploaded-video analysis jobs.")
    parser.add_argument("--once", action="store_true", help="Process at most one queued video, then exit.")
    return parser.parse_args()


def main() -> int:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s %(message)s")
    args = parse_args()
    try:
        settings = Settings.from_environment()
        pipeline = build_pipeline(settings)
    except Exception as error:
        logging.error("worker_configuration_error: %s", error)
        return 2
    if args.once:
        pipeline.process_next()
        return 0
    logging.info("worker_started mode=%s poll_seconds=%s", settings.analysis_mode, settings.poll_seconds)
    while True:
        try:
            if not pipeline.process_next():
                time.sleep(settings.poll_seconds)
        except KeyboardInterrupt:
            logging.info("worker_stopped")
            return 0
        except Exception:
            logging.exception("worker_loop_error")
            time.sleep(settings.poll_seconds)


if __name__ == "__main__":
    sys.exit(main())
