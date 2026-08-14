"""Tests for the cartoon sprite sheet renderer."""

from __future__ import annotations

import unittest
from importlib.util import find_spec

from src.core.models import PetExpression


@unittest.skipUnless(find_spec("cv2") is not None, "cv2 is not installed")
class CartoonSheetTests(unittest.TestCase):
    def test_frame_generation_returns_rgba_image(self) -> None:
        from src.render.cartoon_sheet import CartoonPetSheet

        sheet = CartoonPetSheet(frame_size=160)
        expression = PetExpression(
            state="happy",
            subtitle="hi",
            color=(120, 255, 170),
            mood="joyful",
            animation="happy_spin",
            bond_level=3,
            energy=0.8,
            emote="grin",
        )
        frame = sheet.frame(expression, tick=0.5)
        self.assertEqual(frame.shape, (160, 160, 4))
        self.assertGreater(int(frame[:, :, 3].max()), 0)

    def test_each_skin_renders(self) -> None:
        from src.render.cartoon_sheet import CartoonPetSheet, list_skins

        expression = PetExpression(state="happy", subtitle="hi", color=(120, 255, 170), mood="joyful", animation="hover", emote="grin")
        for skin in list_skins():
            frame = CartoonPetSheet(frame_size=160, skin=skin).frame(expression, tick=0.5)
            self.assertGreater(int(frame[:, :, 3].max()), 0, skin)

    def test_unknown_skin_falls_back_to_fox(self) -> None:
        from src.render.cartoon_sheet import CartoonPetSheet

        self.assertEqual(CartoonPetSheet(skin="nope").skin_name, "fox")


if __name__ == "__main__":
    unittest.main()
