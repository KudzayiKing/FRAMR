from __future__ import annotations

import os
import socket
from dataclasses import dataclass
from pathlib import Path


@dataclass(frozen=True)
class FrameSettings:
    supabase_url: str
    supabase_service_role_key: str
    poll_seconds: float
    lease_seconds: int
    work_dir: Path
    worker_id: str
    segmentation_provider: str
    sam2_checkpoint: Path
    sam2_model_config: str
    sam2_device: str
    sam3_checkpoint_directory: Path
    sam3_device: str
    localized_editor: str
    flux_api_key: str
    flux_model: str
    flux_timeout_seconds: float
    gemini_api_key: str
    gemini_model: str
    gemini_timeout_seconds: float
    nvidia_api_key: str
    nim_model: str
    nim_timeout_seconds: float
    nim_steps: int

    @classmethod
    def from_environment(cls) -> "FrameSettings":
        url = os.getenv("SUPABASE_URL", "").strip()
        key = os.getenv("SUPABASE_SERVICE_ROLE_KEY", "").strip()
        if not url or not key:
            raise ValueError("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required.")
        work_dir = Path(os.getenv("FRAMR_FRAME_WORK_DIR", "/tmp/framr-frame-preserving"))
        work_dir.mkdir(parents=True, exist_ok=True)
        poll_seconds = max(1.0, float(os.getenv("FRAMR_FRAME_POLL_SECONDS", "5")))
        lease_seconds = max(30, int(os.getenv("FRAMR_FRAME_LEASE_SECONDS", "300")))
        worker_id = os.getenv("FRAMR_FRAME_WORKER_ID", f"{socket.gethostname()}-frame-worker")
        segmentation_provider = os.getenv("FRAMR_SEGMENTATION_PROVIDER", "dev").strip().lower()
        if segmentation_provider not in {"dev", "sam2", "sam3"}:
            raise ValueError("FRAMR_SEGMENTATION_PROVIDER must be one of 'dev', 'sam2', or 'sam3'.")
        localized_editor = os.getenv("FRAMR_LOCALIZED_EDITOR", "dev").strip().lower()
        if localized_editor not in {"dev", "gemini", "nim"}:
            raise ValueError("FRAMR_LOCALIZED_EDITOR must be one of 'dev', 'gemini', or 'nim' while FLUX is disabled for testing.")
        sam2_checkpoint = Path(os.getenv("FRAMR_SAM2_CHECKPOINT", str(work_dir / "models" / "sam2.1_hiera_tiny.pt")))
        return cls(
            supabase_url=url,
            supabase_service_role_key=key,
            poll_seconds=poll_seconds,
            lease_seconds=lease_seconds,
            work_dir=work_dir,
            worker_id=worker_id,
            segmentation_provider=segmentation_provider,
            sam2_checkpoint=sam2_checkpoint,
            sam2_model_config=os.getenv("FRAMR_SAM2_MODEL_CONFIG", "configs/sam2.1/sam2.1_hiera_t.yaml"),
            sam2_device=os.getenv("FRAMR_SAM2_DEVICE", "auto").strip().lower(),
            sam3_checkpoint_directory=Path(os.getenv("FRAMR_SAM3_CHECKPOINT_DIRECTORY", str(work_dir / "models" / "sam3"))),
            sam3_device=os.getenv("FRAMR_SAM3_DEVICE", "cuda").strip().lower(),
            localized_editor=localized_editor,
            flux_api_key=os.getenv("BFL_API_KEY", "").strip(),
            flux_model=os.getenv("FRAMR_FLUX_MODEL", "flux-2-pro").strip(),
            flux_timeout_seconds=max(30.0, float(os.getenv("FRAMR_FLUX_TIMEOUT_SECONDS", "180"))),
            gemini_api_key=os.getenv("GEMINI_API_KEY", "").strip(),
            gemini_model=os.getenv("FRAMR_GEMINI_MODEL", "gemini-2.5-flash-image").strip(),
            gemini_timeout_seconds=max(30.0, float(os.getenv("FRAMR_GEMINI_TIMEOUT_SECONDS", "90"))),
            nvidia_api_key=os.getenv("NVIDIA_API_KEY", "").strip(),
            nim_model=os.getenv("FRAMR_NIM_MODEL", "flux.2-klein-4b").strip(),
            nim_timeout_seconds=max(30.0, float(os.getenv("FRAMR_NIM_TIMEOUT_SECONDS", "120"))),
            nim_steps=max(1, int(os.getenv("FRAMR_NIM_STEPS", "4"))),
        )
