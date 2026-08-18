from __future__ import annotations

import logging
import tempfile
from pathlib import Path
from typing import Protocol

from .media import MediaProcessor
from .models import AnalysisResult, VideoJob, VideoMetadata
from .repository import AnalysisRepository
from .settings import Settings
from .storage import ObjectStorage

logger = logging.getLogger(__name__)


class Analyzer(Protocol):
    def analyze(self, job: VideoJob, metadata: VideoMetadata, source_path: Path) -> AnalysisResult: ...


class AnalysisPipeline:
    def __init__(self, settings: Settings, repository: AnalysisRepository, storage: ObjectStorage, media: MediaProcessor, analyzer: Analyzer) -> None:
        self.settings = settings
        self.repository = repository
        self.storage = storage
        self.media = media
        self.analyzer = analyzer

    def process_next(self) -> bool:
        job = self.repository.claim_next_job()
        if job is None:
            return False
        self.process(job)
        return True

    def process(self, job: VideoJob) -> None:
        if job.processing_attempts > self.settings.max_attempts:
            self.repository.mark_failed(job, "Analysis exceeded the configured retry limit.")
            return
        suffix = Path(job.storage_key).suffix.lower() or ".mp4"
        try:
            with tempfile.TemporaryDirectory(prefix=f"framr-{job.id}-", dir=self.settings.work_dir) as directory:
                work_dir = Path(directory)
                source_path = work_dir / f"source{suffix}"
                thumbnail_path = work_dir / "thumbnail.jpg"
                self.storage.download_source_video(job.storage_key, source_path)
                metadata = self.media.inspect(source_path)
                self.media.create_thumbnail(source_path, thumbnail_path, metadata.duration_seconds)
                result = self.analyzer.analyze(job, metadata, source_path)
                self.repository.replace_analysis(job, result)
                thumbnail_key = self.storage.upload_thumbnail(job.owner_id, job.id, thumbnail_path)
                self.repository.mark_ready(job, metadata, thumbnail_key)
                logger.info("analysis_complete video_id=%s scenes=%s", job.id, len(result.scenes))
        except Exception as error:
            logger.exception("analysis_failed video_id=%s", job.id)
            self.repository.mark_failed(job, self._public_error(error))

    @staticmethod
    def _public_error(error: Exception) -> str:
        detail = str(error).strip()
        return detail[:500] if detail else "Video analysis could not be completed."
