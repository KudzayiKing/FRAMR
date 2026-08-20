from __future__ import annotations

import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from framr_worker.flux_provider import FluxConfiguration, FluxLocalizedImageEditor
from framr_worker.frame_providers import LocalizedEditRequest


class FluxLocalizedImageEditorTests(unittest.TestCase):
    def test_submits_crop_and_product_reference_then_persists_ready_edit(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            crop = root / "crop.jpg"
            mask = root / "mask.png"
            product = root / "product.png"
            crop.write_bytes(b"crop")
            mask.write_bytes(b"mask")
            product.write_bytes(b"product")
            provider = FluxLocalizedImageEditor(FluxConfiguration(api_key="test-key", poll_seconds=0.0))
            responses = iter([
                {"polling_url": "https://poll.example/job"},
                {"status": "Ready", "result": {"sample": "https://delivery.example/edit.jpg"}},
            ])
            request = LocalizedEditRequest(
                source_crop=crop,
                target_mask=mask,
                product_reference_paths=(product,),
                source_crop_url="https://private.example/crop.jpg",
                product_reference_urls=("https://private.example/product.png",),
                instruction="Replace the selected item.",
            )
            with patch.object(provider, "_json_request", side_effect=responses) as mocked_request, patch.object(provider, "_download") as mocked_download:
                result = provider.edit_placement(request)

            self.assertEqual(result.edited_crop, root / "crop-flux.jpg")
            self.assertEqual(result.alpha_mask, mask)
            endpoint, = mocked_request.call_args_list[0].args
            self.assertTrue(endpoint.endswith("/v1/flux-2-pro"))
            payload = mocked_request.call_args_list[0].kwargs["payload"]
            self.assertEqual(payload["input_image"], "https://private.example/crop.jpg")
            self.assertEqual(payload["input_image_2"], "https://private.example/product.png")
            mocked_download.assert_called_once_with("https://delivery.example/edit.jpg", root / "crop-flux.jpg")


if __name__ == "__main__":
    unittest.main()
