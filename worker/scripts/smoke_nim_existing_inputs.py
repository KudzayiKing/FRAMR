from __future__ import annotations

import os
from pathlib import Path

from framr_worker.frame_providers import LocalizedEditRequest
from framr_worker.nim_provider import NimConfiguration, NimLocalizedImageEditor


RUN_ID = "407a168f-95d7-4680-acd0-14b338e5e2bb"
ROOT = Path("/tmp/framr-frame-preserving") / RUN_ID / "flux-edits"


def main() -> None:
    editor = NimLocalizedImageEditor(
        NimConfiguration(
            api_key=os.environ["NVIDIA_API_KEY"],
            steps=4,
        )
    )
    result = editor.edit_placement(
        LocalizedEditRequest(
            source_crop=ROOT / "crop-000109.jpg",
            target_mask=ROOT / "mask-000109.png",
            product_reference_paths=(ROOT / "product-0.webp",),
            instruction=(
                "Replace only the selected object in the first image with the product shown in the second image. "
                "Preserve the scene, hands, food, lighting, background, framing, and everything outside the selected object."
            ),
        )
    )
    print(f"nim_smoke=success bytes={result.edited_crop.stat().st_size} output={result.edited_crop.name}")


if __name__ == "__main__":
    main()
