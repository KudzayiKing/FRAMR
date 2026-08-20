from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path

from .frame_providers import SegmentationRequest, SegmentationResult
from .frame_types import ProviderUnavailable


@dataclass(frozen=True)
class Sam3Configuration:
    checkpoint_directory: Path
    device: str = "cuda"


class Sam3VideoSegmentationProvider:
    """Configuration-gated SAM 3 adapter boundary.

    SAM 3 adds concept/text prompting, but Meta's official local runtime requires
    gated checkpoints and a CUDA 12.6+ GPU. This guard is deliberate: selecting
    `sam3` on an unsupported host must stop a protected run for review rather
    than silently falling back to SAM 2 or a whole-video generator.
    """

    name = "sam3"
    model = "sam3-gated"

    def __init__(self, configuration: Sam3Configuration) -> None:
        self.configuration = configuration

    def segment_and_track(self, request: SegmentationRequest) -> SegmentationResult:
        try:
            import torch
        except ImportError as error:
            raise ProviderUnavailable("SAM 3 requires its CUDA-enabled PyTorch runtime.") from error
        if self.configuration.device != "cuda" or not torch.cuda.is_available():
            raise ProviderUnavailable(
                "SAM 3 is configured but unavailable on this host. Meta's official SAM 3 runtime requires gated checkpoints and a CUDA-compatible GPU; use the validated SAM 2.1 adapter on this MPS machine."
            )
        if not self.configuration.checkpoint_directory.exists():
            raise ProviderUnavailable("SAM 3 checkpoint access has not been configured for this worker.")
        raise ProviderUnavailable(
            "SAM 3 runtime prerequisites are present, but its production adapter is intentionally deferred until a CUDA host and approved gated checkpoint credentials are configured."
        )
