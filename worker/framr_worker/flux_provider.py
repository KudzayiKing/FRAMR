from __future__ import annotations

import json
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

from .frame_providers import LocalizedEditRequest, LocalizedEditResult
from .frame_types import NeedsReview, ProviderUnavailable


@dataclass(frozen=True)
class FluxConfiguration:
    api_key: str
    model: str = "flux-2-pro"
    endpoint: str = "https://api.bfl.ai"
    poll_seconds: float = 1.0
    timeout_seconds: float = 180.0


class FluxLocalizedImageEditor:
    """Edits a single private placement crop with a product reference via FLUX.2."""

    name = "flux"

    def __init__(self, configuration: FluxConfiguration) -> None:
        if not configuration.api_key:
            raise ProviderUnavailable("FLUX editing is not configured for this worker.")
        self.configuration = configuration
        self.model = configuration.model

    def edit_placement(self, request: LocalizedEditRequest) -> LocalizedEditResult:
        if not request.source_crop_url or not request.product_reference_urls:
            raise ProviderUnavailable("FLUX needs temporary private URLs for the selected crop and product reference.")
        payload: dict[str, Any] = {
            "prompt": request.instruction,
            "input_image": request.source_crop_url,
            "input_image_2": request.product_reference_urls[0],
            "output_format": "jpeg",
            "safety_tolerance": 2,
            "disable_pup": True,
        }
        response = self._json_request(
            f"{self.configuration.endpoint.rstrip('/')}/v1/{self.configuration.model}",
            method="POST",
            payload=payload,
        )
        polling_url = response.get("polling_url")
        if not isinstance(polling_url, str) or not polling_url:
            raise RuntimeError("FLUX did not return a polling URL for the localized edit.")
        result_url = self._wait_for_result(polling_url)
        output_path = request.source_crop.with_name(f"{request.source_crop.stem}-flux.jpg")
        self._download(result_url, output_path)
        return LocalizedEditResult(edited_crop=output_path, alpha_mask=request.target_mask)

    def _wait_for_result(self, polling_url: str) -> str:
        deadline = time.monotonic() + self.configuration.timeout_seconds
        while time.monotonic() < deadline:
            time.sleep(self.configuration.poll_seconds)
            response = self._json_request(polling_url, method="GET")
            status = str(response.get("status", "")).lower()
            if status == "ready":
                result = response.get("result")
                sample = result.get("sample") if isinstance(result, dict) else None
                if isinstance(sample, str) and sample:
                    return sample
                raise RuntimeError("FLUX completed without an editable image result.")
            if status in {"error", "failed"}:
                detail = response.get("detail") or response.get("error") or "FLUX could not edit this selected product region."
                raise NeedsReview(str(detail))
        raise NeedsReview("FLUX took too long to finish this preview. Please try again shortly.")

    def _json_request(self, url: str, *, method: str, payload: dict[str, Any] | None = None) -> dict[str, Any]:
        body = json.dumps(payload).encode("utf-8") if payload is not None else None
        headers = {"accept": "application/json", "x-key": self.configuration.api_key}
        if body is not None:
            headers["content-type"] = "application/json"
        request = Request(url, data=body, headers=headers, method=method)
        try:
            with urlopen(request, timeout=30) as response:
                parsed = json.loads(response.read().decode("utf-8"))
        except HTTPError as error:
            detail = error.read().decode("utf-8", errors="replace")[:500]
            if error.code == 402:
                raise ProviderUnavailable("FLUX editing credits are unavailable for this preview.") from error
            raise RuntimeError(f"FLUX request failed ({error.code}): {detail}") from error
        except URLError as error:
            raise RuntimeError("FRAMR could not reach FLUX for this preview.") from error
        if not isinstance(parsed, dict):
            raise RuntimeError("FLUX returned an unexpected response.")
        return parsed

    @staticmethod
    def _download(url: str, destination: Path) -> None:
        try:
            with urlopen(url, timeout=60) as response:
                payload = response.read()
        except (HTTPError, URLError) as error:
            raise RuntimeError("FRAMR could not retrieve the completed FLUX edit.") from error
        if not payload:
            raise RuntimeError("FLUX returned an empty localized edit.")
        destination.write_bytes(payload)
