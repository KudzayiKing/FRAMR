from __future__ import annotations

from datetime import UTC, datetime
from typing import Any

from .models import AnalysisResult, VideoJob, VideoMetadata


class AnalysisRepository:
    def __init__(self, client: Any) -> None:
        self.client = client

    def claim_next_job(self) -> VideoJob | None:
        response = self.client.rpc("claim_next_video_for_analysis").execute()
        rows = response.data or []
        return VideoJob.from_row(rows[0]) if rows else None

    def update_progress(self, job: VideoJob, stage: str, progress: int, thumbnail_key: str | None = None) -> None:
        values: dict[str, Any] = {
            "analysis_stage": stage,
            "analysis_progress": max(0, min(100, progress)),
        }
        if thumbnail_key is not None:
            values["thumbnail_key"] = thumbnail_key
        self.client.table("videos").update(values).eq("id", job.id).execute()

    def replace_analysis(self, job: VideoJob, result: AnalysisResult) -> None:
        self.client.table("placements").delete().eq("video_id", job.id).execute()
        self.client.table("video_scenes").delete().eq("video_id", job.id).execute()
        for scene in result.scenes:
            scene_result = self.client.table("video_scenes").insert(
                {"video_id": job.id, "start_seconds": scene.start_seconds, "end_seconds": scene.end_seconds}
            ).execute()
            scene_id = scene_result.data[0]["id"]
            for detected in scene.objects:
                object_result = self.client.table("video_objects").insert(
                    {
                        "scene_id": scene_id,
                        "label": detected.label,
                        "category": detected.category,
                        "confidence": detected.confidence,
                        "box": detected.box.as_dict(),
                        "start_seconds": detected.start_seconds,
                        "end_seconds": detected.end_seconds,
                    }
                ).execute()
                object_id = object_result.data[0]["id"]
                placement_result = self.client.table("placements").insert(
                    {
                        "owner_id": job.owner_id,
                        "video_id": job.id,
                        "object_id": object_id,
                        "object_label": detected.label,
                        "category": detected.category,
                        "start_seconds": detected.start_seconds,
                        "end_seconds": detected.end_seconds,
                        "quality": detected.quality,
                        "confidence": detected.confidence,
                        "box": detected.box.as_dict(),
                        "status": "draft",
                        "is_marketplace_public": False,
                    }
                ).execute()
                placement_id = placement_result.data[0]["id"]
                if detected.tracks:
                    self.client.table("placement_tracks").insert(
                        [
                            {"placement_id": placement_id, "frame_index": point.frame_index, "box": point.box.as_dict()}
                            for point in detected.tracks
                        ]
                    ).execute()

    def mark_ready(self, job: VideoJob, metadata: VideoMetadata, thumbnail_key: str) -> None:
        self.client.table("videos").update(
            {
                "status": "ready",
                "duration_seconds": metadata.duration_seconds,
                "width": metadata.width,
                "height": metadata.height,
                "frame_rate": metadata.frame_rate,
                "frame_count": metadata.frame_count,
                "has_audio": metadata.has_audio,
                "thumbnail_key": thumbnail_key,
                "processing_error": None,
                "analysis_stage": "complete",
                "analysis_progress": 100,
                "processed_at": datetime.now(UTC).isoformat(),
            }
        ).eq("id", job.id).execute()

    def mark_failed(self, job: VideoJob, message: str) -> None:
        self.client.table("videos").update(
            {"status": "failed", "processing_error": message[:500], "analysis_stage": "failed"}
        ).eq("id", job.id).execute()
