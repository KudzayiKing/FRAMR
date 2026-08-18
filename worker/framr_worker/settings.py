from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path


@dataclass(frozen=True)
class Settings:
    supabase_url: str
    supabase_service_role_key: str
    analysis_mode: str
    poll_seconds: float
    max_attempts: int
    ffmpeg_bin: str
    ffprobe_bin: str
    work_dir: Path
    yolo_model: str
    tracker_config: str

    @classmethod
    def from_environment(cls) -> "Settings":
        mode = os.getenv("FRAMR_ANALYSIS", "mock").strip().lower()
        if mode not in {"mock", "live"}:
            raise ValueError("FRAMR_ANALYSIS must be either 'mock' or 'live'.")
        url = os.getenv("SUPABASE_URL", "").strip()
        key = os.getenv("SUPABASE_SERVICE_ROLE_KEY", "").strip()
        if not url or not key:
            raise ValueError("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required.")
        work_dir = Path(os.getenv("FRAMR_WORK_DIR", "/tmp/framr-analysis"))
        work_dir.mkdir(parents=True, exist_ok=True)
        return cls(
            supabase_url=url,
            supabase_service_role_key=key,
            analysis_mode=mode,
            poll_seconds=max(1.0, float(os.getenv("FRAMR_POLL_SECONDS", "5"))),
            max_attempts=max(1, int(os.getenv("FRAMR_MAX_ANALYSIS_ATTEMPTS", "3"))),
            ffmpeg_bin=os.getenv("FRAMR_FFMPEG_BIN", "ffmpeg"),
            ffprobe_bin=os.getenv("FRAMR_FFPROBE_BIN", "ffprobe"),
            work_dir=work_dir,
            yolo_model=os.getenv("FRAMR_YOLO_MODEL", "yolo11n.pt"),
            tracker_config=os.getenv("FRAMR_TRACKER_CONFIG", "bytetrack.yaml"),
        )
