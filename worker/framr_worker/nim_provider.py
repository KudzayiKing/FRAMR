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
class NimConfiguration:
    api_key: str
    model: str = "flux.2-klein-4b"
    endpoint: str = "https://ai.api.nvidia.com/v1/genai/black-forest-labs/flux.2-klein-4b"
    timeout_seconds: float = 120.0
    steps: int = 4


class NimLocalizedImageEditor:
    """NVIDIA NIM FLUX.2 Klein multi-reference local image editing provider."""

    name = "nvidia-nim"

    def __init__(self, configuration: NimConfiguration) -> None:
        if not configuration.api_key:
            raise ProviderUnavailable("NVIDIA NIM editing is not configured for this worker.")
        self.configuration = configuration
        self.model = configuration.model

    def edit_placement(self, request: LocalizedEditRequest) -> LocalizedEditResult:
        # NVIDIA's hosted prototype endpoint only accepts its predefined example images.
        # It cannot receive private creator crops or product references, so fail safely
        # before transmitting media or generating a misleading retry loop.
        raise ProviderUnavailable(
            "The current preview editor is being connected. Your selected item and product are safely saved."
        )
        if not request.product_reference_paths:
            raise NeedsReview("A selected product image is needed to create this preview.")
        images = [request.source_crop, *request.product_reference_paths[:3]]
        payload = {
            "prompt": request.instruction,
            "image": [self._encode_image(path) for path in images],
            "width": 1024,
            "height": 1024,
            "steps": self.configuration.steps,
            "seed": 0,
        }
        response = self._request(payload)
        output = self._extract_image(response)
        destination = request.source_crop.with_name(f"{request.source_crop.stem}-nim.jpg")
        destination.write_bytes(output)
        return LocalizedEditResult(edited_crop=destination, alpha_mask=request.target_mask)

    @staticmethod
    def _encode_image(path: Path) -> str:
        mime_type = mimetypes.guess_type(path.name)[0] or "image/jpeg"
        encoded = base64.b64encode(path.read_bytes()).decode("ascii")
        return f"data:{mime_type};base64,{encoded}"

    def _request(self, payload: dict[str, object]) -> dict[str, object]:
        request = Request(
            self.configuration.endpoint,
            data=json.dumps(payload).encode("utf-8"),
            headers={
                "Authorization": f"Bearer {self.configuration.api_key}",
                "Accept": "application/json",
                "Content-Type": "application/json",
            },
            method="POST",
        )
        try:
            with urlopen(request, timeout=self.configuration.timeout_seconds) as response:
                parsed = json.loads(response.read().decode("utf-8"))
        except HTTPError as error:
            detail = error.read().decode("utf-8", errors="replace")[:500]
            if error.code in {401, 403}:
                raise ProviderUnavailable("NVIDIA NIM rejected this key or the FLUX.2 Klein trial model is not enabled.") from error
            if error.code == 429:
                raise NeedsReview("NVIDIA NIM is at its temporary prototype limit. Please try again shortly.") from error
            raise RuntimeError(f"NVIDIA NIM image edit failed ({error.code}): {detail}") from error
        except URLError as error:
            raise RuntimeError("FRAMR could not reach NVIDIA NIM for this preview.") from error
        if not isinstance(parsed, dict):
            raise RuntimeError("NVIDIA NIM returned an unexpected response.")
        return parsed

    @staticmethod
    def _extract_image(response: dict[str, object]) -> bytes:
        candidates: list[object] = []
        artifacts = response.get("artifacts")
        if isinstance(artifacts, list):
            candidates.extend(artifacts)
        data = response.get("data")
        if isinstance(data, list):
            candidates.extend(data)
        image = response.get("image")
        if image is not None:
            candidates.append(image)
        for candidate in candidates:
            if isinstance(candidate, str):
                encoded = candidate
            elif isinstance(candidate, dict):
                encoded = candidate.get("base64") or candidate.get("b64_json") or candidate.get("image")
            else:
                continue
            if not isinstance(encoded, str) or not encoded:
                continue
            if encoded.startswith("data:"):
                encoded = encoded.split(",", 1)[-1]
            try:
                output = base64.b64decode(encoded, validate=True)
            except ValueError:
                continue
            if output:
                return output
        raise RuntimeError("NVIDIA NIM did not return an edited image artifact.")
