from __future__ import annotations

import base64
import json
import mimetypes
from dataclasses import dataclass
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

from .frame_providers import LocalizedEditRequest, LocalizedEditResult
from .frame_types import NeedsReview, ProviderUnavailable


@dataclass(frozen=True)
class GeminiConfiguration:
    api_key: str
    model: str = "gemini-2.5-flash-image"
    endpoint: str = "https://generativelanguage.googleapis.com/v1beta/interactions"
    timeout_seconds: float = 90.0


class GeminiLocalizedImageEditor:
    """Testing-only localized image editor using Gemini text-and-image editing."""

    name = "gemini"

    def __init__(self, configuration: GeminiConfiguration) -> None:
        if not configuration.api_key:
            raise ProviderUnavailable("Gemini editing is not configured for this worker.")
        self.configuration = configuration
        self.model = configuration.model

    def edit_placement(self, request: LocalizedEditRequest) -> LocalizedEditResult:
        if not request.product_reference_paths:
            raise NeedsReview("Gemini needs the selected product reference to create this preview.")
        inputs: list[dict[str, str]] = [{"type": "text", "text": request.instruction}]
        inputs.append(self._image_input(request.source_crop))
        for product_path in request.product_reference_paths[:3]:
            inputs.append(self._image_input(product_path))
        payload = {
            "model": self.configuration.model,
            "input": inputs,
            "response_format": {"type": "image", "mime_type": "image/jpeg"},
        }
        response = self._request(payload)
        image = response.get("output_image")
        encoded = image.get("data") if isinstance(image, dict) else None
        if not isinstance(encoded, str) or not encoded:
            raise NeedsReview("Gemini did not return an edited product crop for this preview.")
        try:
            output = base64.b64decode(encoded, validate=True)
        except ValueError as error:
            raise RuntimeError("Gemini returned an unreadable edited image.") from error
        if not output:
            raise RuntimeError("Gemini returned an empty edited image.")
        destination = request.source_crop.with_name(f"{request.source_crop.stem}-gemini.jpg")
        destination.write_bytes(output)
        return LocalizedEditResult(edited_crop=destination, alpha_mask=request.target_mask)

    @staticmethod
    def _image_input(path: Path) -> dict[str, str]:
        mime_type, _ = mimetypes.guess_type(path.name)
        if mime_type not in {"image/jpeg", "image/png", "image/webp"}:
            mime_type = "image/jpeg"
        return {
            "type": "image",
            "mime_type": mime_type,
            "data": base64.b64encode(path.read_bytes()).decode("ascii"),
        }

    def _request(self, payload: dict[str, object]) -> dict[str, object]:
        request = Request(
            self.configuration.endpoint,
            data=json.dumps(payload).encode("utf-8"),
            headers={"content-type": "application/json", "x-goog-api-key": self.configuration.api_key},
            method="POST",
        )
        try:
            with urlopen(request, timeout=self.configuration.timeout_seconds) as response:
                parsed = json.loads(response.read().decode("utf-8"))
        except HTTPError as error:
            detail = error.read().decode("utf-8", errors="replace")[:500]
            if error.code in {401, 403}:
                raise ProviderUnavailable("Gemini rejected the testing key or this image model is not enabled for the project.") from error
            if error.code == 429:
                raise NeedsReview("Gemini testing limits are busy. Please try the preview again shortly.") from error
            raise RuntimeError(f"Gemini image edit failed ({error.code}): {detail}") from error
        except URLError as error:
            raise RuntimeError("FRAMR could not reach Gemini for this test preview.") from error
        if not isinstance(parsed, dict):
            raise RuntimeError("Gemini returned an unexpected response.")
        return parsed
