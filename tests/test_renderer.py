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


@unittest.skipUnless(find_spec("cv2") is not None, "cv2 is not installed")
class AnchorTests(unittest.TestCase):
    def _renderer(self):
        from src.render.renderer import HoloPetRenderer

        return HoloPetRenderer()

    def test_body_anchors_resolve(self) -> None:
        from src.core.models import MovementCommand, PetExpression, TrackingSnapshot

        renderer = self._renderer()
        tracking = TrackingSnapshot(
            frame_size=(640, 480),
            left_elbow=(10, 20),
            right_hip=(30, 40),
            left_knee=(50, 60),
        )
        for anchor_name, expected in (
            ("left_elbow", (10, 20)),
            ("right_hip", (30, 40)),
            ("left_knee", (50, 60)),
        ):
            expression = PetExpression(
                state="following", subtitle="", color=(0, 0, 0),
                movement=MovementCommand(target_anchor=anchor_name),
            )
            self.assertEqual(renderer._resolve_anchor(tracking, expression), expected)

    def test_following_falls_back_to_wrist_when_palm_missing(self) -> None:
        from src.core.models import PetExpression, TrackingSnapshot

        renderer = self._renderer()
        tracking = TrackingSnapshot(frame_size=(640, 480), right_wrist=(100, 200))
        expression = PetExpression(state="following", subtitle="", color=(0, 0, 0))
        self.assertEqual(renderer._fallback_anchor(tracking, "following"), (100, 130))


if __name__ == "__main__":
    unittest.main()
