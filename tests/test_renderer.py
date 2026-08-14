"""Tests for renderer movement feel."""

from __future__ import annotations

import unittest
from importlib.util import find_spec


@unittest.skipUnless(find_spec("cv2") is not None, "cv2 is not installed")
class SmoothMoveTests(unittest.TestCase):
    def _renderer(self):
        from src.render.renderer import HoloPetRenderer

        renderer = HoloPetRenderer()
        renderer._pet_position = (100, 100)
        return renderer

    def test_dash_blends_faster_than_hover(self) -> None:
        renderer = self._renderer()
        anchor = (300, 100)
        dash_pos = renderer._smooth_move(anchor, speed=1.0, animation="dash")
        renderer._pet_position = (100, 100)
        hover_pos = renderer._smooth_move(anchor, speed=1.0, animation="hover")
        self.assertGreater(dash_pos[0], hover_pos[0])

    def test_peek_blends_slower_than_hover(self) -> None:
        renderer = self._renderer()
        anchor = (300, 100)
        peek_pos = renderer._smooth_move(anchor, speed=1.0, animation="peek")
        renderer._pet_position = (100, 100)
        hover_pos = renderer._smooth_move(anchor, speed=1.0, animation="hover")
        self.assertLess(peek_pos[0], hover_pos[0])

    def test_jump_has_higher_arc_than_hover(self) -> None:
        renderer = self._renderer()
        anchor = (300, 100)
        jump_pos = renderer._smooth_move(anchor, speed=1.0, animation="jump_to_shoulder")
        renderer._pet_position = (100, 100)
        hover_pos = renderer._smooth_move(anchor, speed=1.0, animation="hover")
        self.assertLess(jump_pos[1], hover_pos[1])

    def test_first_move_is_exact(self) -> None:
        from src.render.renderer import HoloPetRenderer

        renderer = HoloPetRenderer()
        self.assertEqual(renderer._smooth_move((50, 60), speed=1.0), (50, 60))


if __name__ == "__main__":
    unittest.main()
