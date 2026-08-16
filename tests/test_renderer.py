"""Integration tests for OpenCV rendering over the pure motion module."""

from __future__ import annotations

import unittest
from importlib.util import find_spec


@unittest.skipUnless(find_spec("cv2") is not None, "cv2 is not installed")
class RendererIntegrationTests(unittest.TestCase):
    @staticmethod
    def _expression():
        from src.core.models import MovementCommand, PetExpression

        return PetExpression(
            state="following",
            subtitle="Aku ikut.",
            color=(120, 220, 255),
            animation="perch",
            movement=MovementCommand(target_anchor="right_shoulder", offset_x=80, offset_y=-30),
        )

    def test_renderer_consumes_body_relative_motion(self) -> None:
        import numpy as np

        from src.core.models import TrackingSnapshot
        from src.render.renderer import HoloPetRenderer

        frame = np.zeros((480, 640, 3), dtype=np.uint8)
        tracking = TrackingSnapshot(
            frame_size=(640, 480),
            pose_anchors={"right_shoulder": (280, 250)},
            anchor_confidence={"right_shoulder": 0.95},
            body_scale_px=115.0,
        )
        renderer = HoloPetRenderer()

        output = renderer.render(frame, tracking, self._expression(), show_debug=False)

        self.assertGreater(int(output.sum()), 0)
        self.assertIsNotNone(renderer._last_motion)
        assert renderer._last_motion is not None
        self.assertEqual(renderer._last_motion.sprite_scale, 0.55)  # safe minimum
        self.assertEqual(renderer._last_motion.tracking_state, "direct")

    def test_renderer_freezes_pet_when_tracking_temporarily_disappears(self) -> None:
        import numpy as np

        from src.core.models import TrackingSnapshot
        from src.render.renderer import HoloPetRenderer

        frame = np.zeros((480, 640, 3), dtype=np.uint8)
        renderer = HoloPetRenderer()
        renderer.render(
            frame,
            TrackingSnapshot(
                frame_size=(640, 480),
                pose_anchors={"right_shoulder": (300, 240)},
                anchor_confidence={"right_shoulder": 0.9},
            ),
            self._expression(),
            show_debug=False,
        )
        first_position = renderer._last_motion.position  # type: ignore[union-attr]

        output = renderer.render(
            frame,
            TrackingSnapshot(frame_size=(640, 480), pose_anchors={}),
            self._expression(),
            show_debug=False,
        )

        self.assertGreater(int(output.sum()), 0)
        self.assertEqual(renderer._last_motion.tracking_state, "frozen")  # type: ignore[union-attr]
        self.assertEqual(renderer._last_motion.position, first_position)  # type: ignore[union-attr]

    def test_debug_overlay_draws_visible_body_bounds(self) -> None:
        import numpy as np

        from src.core.models import TrackingSnapshot
        from src.render.renderer import HoloPetRenderer

        frame = np.zeros((480, 640, 3), dtype=np.uint8)
        tracking = TrackingSnapshot(
            frame_size=(640, 480),
            pose_anchors={"right_shoulder": (280, 250)},
            anchor_confidence={"right_shoulder": 0.95},
            body_bounds=(100, 80, 500, 450),
        )

        output = HoloPetRenderer().render(frame, tracking, self._expression(), show_debug=True)

        self.assertGreater(int(output[80, 100].sum()), 0)

    def test_bob_and_evolved_scale_keep_sprite_inside_top_edge(self) -> None:
        import math
        from unittest import mock

        import numpy as np

        from src.core.models import PetExpression
        from src.render.motion import MotionPose
        from src.render.renderer import HoloPetRenderer

        renderer = HoloPetRenderer()
        renderer._start_time = 0.0
        canvas = np.zeros((480, 640, 3), dtype=np.uint8)
        expression = PetExpression(
            state="evolved",
            subtitle="Zoom!",
            color=(120, 220, 255),
            energy=1.0,
            bond_level=5,
        )
        motion = MotionPose(
            position=(320.0, 88.0),
            speed_px_s=0.0,
            sprite_scale=1.0,
            resolved_anchor="nose",
            tracking_state="direct",
            target=(320.0, 88.0),
        )
        negative_bob_time = 3.0 * math.pi / (2.0 * 2.5)

        with mock.patch("src.render.renderer.time.monotonic", return_value=negative_bob_time), mock.patch(
            "src.render.renderer.composite_sprite"
        ) as composite:
            renderer._draw_pet(canvas, (320, 88), expression, motion)

        sprite, center = composite.call_args.args[1:3]
        scale = composite.call_args.kwargs["scale"]
        self.assertGreaterEqual(center[1] - sprite.shape[0] * scale * 0.5, 0.0)


if __name__ == "__main__":
    unittest.main()
