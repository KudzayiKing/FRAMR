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

    @staticmethod
    def _split_key(storage_key: str) -> tuple[str, str]:
        bucket, separator, object_path = storage_key.partition("/")
        if not separator or not bucket or not object_path:
            raise ValueError("Storage key must use the format <bucket>/<path>.")
        return bucket, object_path
