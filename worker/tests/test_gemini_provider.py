from __future__ import annotations

import base64
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from framr_worker.gemini_provider import GeminiConfiguration, GeminiLocalizedImageEditor
from framr_worker.frame_providers import LocalizedEditRequest


class GeminiLocalizedImageEditorTests(unittest.TestCase):
    def test_submits_private_crop_and_product_reference_then_writes_result(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            crop = root / "crop.jpg"
            mask = root / "mask.png"
            product = root / "product.png"
            crop.write_bytes(b"crop")
            mask.write_bytes(b"mask")
            product.write_bytes(b"product")
            provider = GeminiLocalizedImageEditor(GeminiConfiguration(api_key="test-key"))
            request = LocalizedEditRequest(
                source_crop=crop,
                target_mask=mask,
                product_reference_paths=(product,),
                instruction="Replace only the selected product.",
            )
            output = base64.b64encode(b"edited-jpeg").decode("ascii")
            with patch.object(provider, "_request", return_value={"output_image": {"data": output}}) as mocked_request:
                result = provider.edit_placement(request)

            self.assertEqual(result.edited_crop.read_bytes(), b"edited-jpeg")
            self.assertEqual(result.alpha_mask, mask)
            payload = mocked_request.call_args.args[0]
            self.assertEqual(payload["model"], "gemini-2.5-flash-image")
            self.assertEqual(payload["input"][0]["type"], "text")
            self.assertEqual(payload["input"][1]["type"], "image")
            self.assertEqual(payload["input"][2]["type"], "image")


if __name__ == "__main__":
    unittest.main()
