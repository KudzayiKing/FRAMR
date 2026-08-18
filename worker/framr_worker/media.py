from __future__ import annotations

import json
import subprocess
from pathlib import Path

from .models import VideoMetadata

MAX_VIDEO_BYTES = 500 * 1024 * 1024
MIN_DURATION_SECONDS = 15.0
MAX_DURATION_SECONDS = 60.0
PORTRAIT_ASPECT_RATIO = 9 / 16
ASPECT_RATIO_TOLERANCE = 0.015
ALLOWED_CODECS = {"h264", "vp8"}


class VideoConstraintError(ValueError):
    """Raised when an uploaded video violates FRAMR's video constraints."""


class MediaProcessor:
    def __init__(self, *, ffmpeg_bin: str, ffprobe_bin: str) -> None:
        self.ffmpeg_bin = ffmpeg_bin
        self.ffprobe_bin = ffprobe_bin

    def inspect(self, source_path: Path) -> VideoMetadata:
        self._validate_file_size(source_path)
        completed = self._run(
            [
                self.ffprobe_bin,
                "-v", "error",
                "-select_streams", "v:0",
                "-show_entries", "stream=codec_name,width,height,avg_frame_rate:format=duration",
                "-of", "json",
                str(source_path),
            ]
        )
        payload = json.loads(completed.stdout)
        stream = (payload.get("streams") or [{}])[0]
        source_format = payload.get("format") or {}
        metadata = VideoMetadata(
            duration_seconds=float(source_format.get("duration") or 0),
            width=int(stream.get("width") or 0),
            height=int(stream.get("height") or 0),
            codec_name=str(stream.get("codec_name") or ""),
            frame_rate=self._parse_frame_rate(str(stream.get("avg_frame_rate") or "0/0")),
        )
        self._validate_metadata(metadata)
        return metadata

    def create_thumbnail(self, source_path: Path, destination_path: Path, duration_seconds: float) -> None:
        seek_seconds = max(0.0, min(duration_seconds * 0.25, max(0.0, duration_seconds - 0.1)))
        self._run(
            [
                self.ffmpeg_bin,
                "-y",
                "-ss", f"{seek_seconds:.3f}",
                "-i", str(source_path),
                "-frames:v", "1",
                "-vf", "scale=360:-2",
                "-q:v", "3",
                str(destination_path),
            ]
        )
        if not destination_path.exists() or destination_path.stat().st_size == 0:
            raise RuntimeError("FFmpeg did not produce a thumbnail.")

    @staticmethod
    def _parse_frame_rate(value: str) -> float:
        numerator, separator, denominator = value.partition("/")
        if separator and denominator not in {"", "0"}:
            return float(numerator) / float(denominator)
        return 30.0

    @staticmethod
    def _validate_file_size(source_path: Path) -> None:
        if not source_path.exists() or source_path.stat().st_size == 0:
            raise VideoConstraintError("The downloaded source video is empty.")
        if source_path.stat().st_size > MAX_VIDEO_BYTES:
            raise VideoConstraintError("Videos must be 500 MB or smaller.")

    @staticmethod
    def _validate_metadata(metadata: VideoMetadata) -> None:
        if metadata.codec_name not in ALLOWED_CODECS:
            raise VideoConstraintError("Videos must use H.264 or VP8 video encoding.")
        if not MIN_DURATION_SECONDS <= metadata.duration_seconds <= MAX_DURATION_SECONDS:
            raise VideoConstraintError("Videos must run between 15 and 60 seconds.")
        if metadata.width <= 0 or metadata.height <= 0:
            raise VideoConstraintError("The source video has no readable dimensions.")
        actual_ratio = metadata.width / metadata.height
        if abs(actual_ratio - PORTRAIT_ASPECT_RATIO) > ASPECT_RATIO_TOLERANCE:
            raise VideoConstraintError("Videos must use a 9:16 portrait frame.")

    @staticmethod
    def _run(command: list[str]) -> subprocess.CompletedProcess[str]:
        try:
            return subprocess.run(command, check=True, text=True, capture_output=True)
        except FileNotFoundError as error:
            raise RuntimeError(f"Required video tool is unavailable: {command[0]}.") from error
        except subprocess.CalledProcessError as error:
            detail = error.stderr.strip() or error.stdout.strip() or "no diagnostic output"
            raise RuntimeError(f"Video processing failed: {detail}") from error
