from __future__ import annotations

from pathlib import Path
from typing import Any


class ObjectStorage:
    def __init__(self, client: Any) -> None:
        self.client = client

    def download_source_video(self, storage_key: str, destination_path: Path) -> None:
        bucket, object_path = self._split_key(storage_key)
        if bucket != "videos":
            raise ValueError("Video source storage keys must use the videos bucket.")
        payload = self.client.storage.from_(bucket).download(object_path)
        destination_path.write_bytes(payload)

    def upload_thumbnail(self, owner_id: str, video_id: str, source_path: Path) -> str:
        object_path = f"{owner_id}/{video_id}.jpg"
        self.client.storage.from_("thumbnails").upload(
            object_path,
            source_path.read_bytes(),
            file_options={"content-type": "image/jpeg", "upsert": "true"},
        )
        return f"thumbnails/{object_path}"

    def upload_generated_preview(self, owner_id: str, run_id: str, video_path: Path, thumbnail_path: Path) -> tuple[str, str]:
        video_object_path = f"{owner_id}/{run_id}.mp4"
        thumbnail_object_path = f"{owner_id}/{run_id}.jpg"
        self.client.storage.from_("generated").upload(
            video_object_path,
            video_path.read_bytes(),
            file_options={"content-type": "video/mp4", "upsert": "true"},
        )
        self.client.storage.from_("thumbnails").upload(
            thumbnail_object_path,
            thumbnail_path.read_bytes(),
            file_options={"content-type": "image/jpeg", "upsert": "true"},
        )
        return f"generated/{video_object_path}", f"thumbnails/{thumbnail_object_path}"

    def upload_artifact_bytes(
        self,
        owner_id: str,
        run_id: str,
        relative_path: str,
        payload: bytes,
        *,
        content_type: str,
    ) -> str:
        cleaned = relative_path.strip("/")
        if not cleaned or ".." in cleaned.split("/"):
            raise ValueError("Artifact paths must be a non-empty relative path.")
        object_path = f"{owner_id}/{run_id}/{cleaned}"
        self.client.storage.from_("artifacts").upload(
            object_path,
            payload,
            file_options={"content-type": content_type, "upsert": "true"},
        )
        return f"artifacts/{object_path}"

    def download_private_object(self, storage_key: str) -> bytes:
        bucket, object_path = self._split_key(storage_key)
        return self.client.storage.from_(bucket).download(object_path)

    def create_private_signed_url(self, storage_key: str, *, expires_in: int = 1_800) -> str:
        bucket, object_path = self._split_key(storage_key)
        response = self.client.storage.from_(bucket).create_signed_url(object_path, expires_in)
        if isinstance(response, dict):
            url = response.get("signedURL") or response.get("signedUrl")
        else:
            url = getattr(response, "signedURL", None) or getattr(response, "signed_url", None)
        if not isinstance(url, str) or not url:
            raise RuntimeError("Could not create a temporary private media URL.")
        return url

    @staticmethod
    def _split_key(storage_key: str) -> tuple[str, str]:
        bucket, separator, object_path = storage_key.partition("/")
        if not separator or not bucket or not object_path:
            raise ValueError("Storage key must use the format <bucket>/<path>.")
        return bucket, object_path
