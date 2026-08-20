from __future__ import annotations

import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from framr_worker.frame_providers import LocalizedEditRequest
from framr_worker.frame_types import ProviderUnavailable
from framr_worker.nim_provider import NimConfiguration, NimLocalizedImageEditor


class NimLocalizedImageEditorTests(unittest.TestCase):
    def test_hosted_trial_blocks_private_creator_inputs_before_transmission(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            crop = root / "crop.jpg"
            mask = root / "mask.png"
            product = root / "product.png"
            crop.write_bytes(b"crop")
            mask.write_bytes(b"mask")
            product.write_bytes(b"product")
            provider = NimLocalizedImageEditor(NimConfiguration(api_key="test-key"))
            request = LocalizedEditRequest(
                source_crop=crop,
                target_mask=mask,
                product_reference_paths=(product,),
                instruction="Replace only the selected product.",
            )
            with patch.object(provider, "_request") as mocked_request:
                with self.assertRaises(ProviderUnavailable):
                    provider.edit_placement(request)
            mocked_request.assert_not_called()


if __name__ == "__main__":
    unittest.main()
