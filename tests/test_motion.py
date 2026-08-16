"""Deterministic tests for cv2-free pet motion."""

from __future__ import annotations

from dataclasses import FrozenInstanceError
import math
import unittest

from src.core.models import MovementCommand, TrackingSnapshot
from src.render.motion import MotionController, MotionPose


class MotionControllerTests(unittest.TestCase):
    @staticmethod
    def _snapshot(
        *,
        frame_size: tuple[int, int] = (1000, 700),
        body_scale_px: float = 230.0,
        anchors: dict[str, tuple[int, int]] | None = None,
        confidence: dict[str, float] | None = None,
    ) -> TrackingSnapshot:
        return TrackingSnapshot(
            frame_size=frame_size,
            pose_anchors=anchors or {},
            anchor_confidence=confidence or {},
            body_scale_px=body_scale_px,
        )

    def test_pose_is_frozen_and_slotted(self) -> None:
        pose = MotionPose((1.0, 2.0), 3.0, 1.0, "nose", "direct", (1.0, 2.0))
        with self.assertRaises(FrozenInstanceError):
            pose.speed_px_s = 10.0  # type: ignore[misc]
        self.assertFalse(hasattr(pose, "__dict__"))

    def test_exponential_smoothing_is_frame_rate_independent(self) -> None:
        command = MovementCommand(target_anchor="nose", speed=1.0)

        def after_one_second(fps: int) -> MotionPose:
            controller = MotionController()
            start = self._snapshot(anchors={"nose": (150, 300)})
            moving = self._snapshot(anchors={"nose": (650, 300)})
            controller.update(start, command, "hover", 0.0)
            pose = None
            for frame in range(1, fps + 1):
                pose = controller.update(moving, command, "hover", frame / fps)
            assert pose is not None
            return pose

        poses = [after_one_second(fps) for fps in (15, 30, 60)]
        for left, right in zip(poses, poses[1:]):
            self.assertAlmostEqual(left.position[0], right.position[0], places=8)
            self.assertAlmostEqual(left.position[1], right.position[1], places=8)

    def test_speed_is_reported_in_pixels_per_second(self) -> None:
        controller = MotionController()
        command = MovementCommand(target_anchor="nose")
        controller.update(self._snapshot(anchors={"nose": (100, 300)}), command, "hover", 0.0)
        pose = controller.update(
            self._snapshot(anchors={"nose": (300, 300)}), command, "hover", 0.1
        )
        self.assertIsNotNone(pose)
        assert pose is not None
        travelled = pose.position[0] - 100.0
        self.assertAlmostEqual(pose.speed_px_s, travelled / 0.1)

    def test_body_scale_and_resolution_keep_normalized_placement(self) -> None:
        command = MovementCommand(target_anchor="right_shoulder", offset_x=100, offset_y=-40)
        low = MotionController().update(
            self._snapshot(
                frame_size=(640, 480),
                body_scale_px=138.0,
                anchors={"right_shoulder": (200, 220)},
            ),
            command,
            "hover",
            0.0,
        )
        high = MotionController().update(
            self._snapshot(
                frame_size=(1280, 960),
                body_scale_px=276.0,
                anchors={"right_shoulder": (400, 440)},
            ),
            command,
            "hover",
            0.0,
        )
        assert low is not None and high is not None
        self.assertEqual(low.sprite_scale, 0.6)
        self.assertEqual(high.sprite_scale, 1.2)
        self.assertAlmostEqual(low.target[0], high.target[0] / 2.0)
        self.assertAlmostEqual(low.target[1], high.target[1] / 2.0)

    def test_short_requested_anchor_dropout_holds_last_direct_target(self) -> None:
        controller = MotionController()
        command = MovementCommand(target_anchor="right_wrist", offset_y=-40)
        direct = self._snapshot(anchors={"right_wrist": (300, 220)})
        fallback_only = self._snapshot(anchors={"right_elbow": (260, 300)})
        first = controller.update(direct, command, "perch", 1.0)
        held = controller.update(fallback_only, command, "perch", 1.2)
        assert first is not None and held is not None
        self.assertEqual(held.tracking_state, "held")
        self.assertEqual(held.target, first.target)

    def test_prolonged_dropout_uses_anatomical_fallback(self) -> None:
        controller = MotionController()
        command = MovementCommand(target_anchor="right_wrist", offset_y=-40)
        controller.update(
            self._snapshot(anchors={"right_wrist": (300, 220)}), command, "perch", 1.0
        )
        fallback = controller.update(
            self._snapshot(anchors={"right_elbow": (260, 300)}), command, "perch", 1.3
        )
        assert fallback is not None
        self.assertEqual(fallback.tracking_state, "fallback")
        self.assertEqual(fallback.target, (260.0, 260.0))

    def test_wrist_fallback_does_not_apply_offset_twice(self) -> None:
        controller = MotionController()
        command = MovementCommand(target_anchor="active_palm", offset_y=-40)
        pose = controller.update(
            self._snapshot(anchors={"right_wrist": (300, 220)}),
            command,
            "perch",
            0.0,
        )
        assert pose is not None
        self.assertEqual(pose.tracking_state, "fallback")
        self.assertEqual(pose.target, (300.0, 180.0))

    def test_active_left_palm_dropout_stays_on_left_wrist(self) -> None:
        controller = MotionController()
        command = MovementCommand(target_anchor="active_palm", offset_y=-40)
        tracking = self._snapshot(
            anchors={"left_wrist": (180, 220), "right_wrist": (760, 220)}
        )
        tracking.active_hand = "left"

        pose = controller.update(tracking, command, "perch", 0.0)

        assert pose is not None
        self.assertEqual(pose.target, (180.0, 180.0))

    def test_active_left_palm_freezes_instead_of_crossing_to_right_arm(self) -> None:
        controller = MotionController()
        command = MovementCommand(target_anchor="active_palm", offset_y=-40)
        direct = self._snapshot(anchors={"active_palm": (180, 220)})
        direct.active_hand = "left"
        opposite_only = self._snapshot(anchors={"right_wrist": (760, 220)})
        opposite_only.active_hand = "left"
        first = controller.update(direct, command, "perch", 0.0)

        frozen = controller.update(opposite_only, command, "perch", 0.3)

        assert first is not None and frozen is not None
        self.assertEqual(frozen.tracking_state, "frozen")
        self.assertEqual(frozen.position, first.position)

    def test_total_tracking_loss_freezes_last_visible_pose(self) -> None:
        controller = MotionController()
        command = MovementCommand(target_anchor="nose")
        first = controller.update(
            self._snapshot(anchors={"nose": (300, 220)}), command, "hover", 0.0
        )
        frozen = controller.update(self._snapshot(), command, "hover", 0.1)
        assert first is not None and frozen is not None
        self.assertEqual(frozen.position, first.position)
        self.assertEqual(frozen.target, first.target)
        self.assertEqual(frozen.speed_px_s, 0.0)
        self.assertEqual(frozen.tracking_state, "frozen")

    def test_low_confidence_requested_anchor_is_ignored(self) -> None:
        controller = MotionController(direct_confidence=0.5)
        command = MovementCommand(target_anchor="right_wrist")
        pose = controller.update(
            self._snapshot(
                anchors={"right_wrist": (700, 100), "right_elbow": (260, 300)},
                confidence={"right_wrist": 0.2, "right_elbow": 0.9},
            ),
            command,
            "hover",
            0.0,
        )
        assert pose is not None
        self.assertEqual(pose.tracking_state, "fallback")
        self.assertEqual(pose.target, (260.0, 300.0))

    def test_command_hop_arc_returns_to_zero_without_snapping_base_motion(self) -> None:
        controller = MotionController()
        first_command = MovementCommand(target_anchor="right_shoulder")
        hop_command = MovementCommand(target_anchor="left_shoulder")
        snapshot = self._snapshot(
            anchors={"right_shoulder": (200, 300), "left_shoulder": (700, 300)}
        )
        controller.update(snapshot, first_command, "hover", 0.0)
        controller.update(snapshot, hop_command, "jump_to_shoulder", 0.01)
        middle = controller.update(snapshot, hop_command, "jump_to_shoulder", 0.25)
        end = controller.update(snapshot, hop_command, "jump_to_shoulder", 1.0)
        assert middle is not None and end is not None
        self.assertLess(middle.position[1], middle.target[1])
        self.assertTrue(math.isclose(end.position[1], end.target[1]))
        self.assertLess(end.position[0], end.target[0])

    def test_hop_expiry_has_no_one_frame_position_snap(self) -> None:
        controller = MotionController()
        first = MovementCommand(target_anchor="right_shoulder")
        move = MovementCommand(target_anchor="left_shoulder")
        snapshot = self._snapshot(
            anchors={"right_shoulder": (100, 300), "left_shoulder": (700, 300)}
        )
        controller.update(snapshot, first, "drift", 0.0)
        previous = controller.update(snapshot, move, "drift", 1.0 / 60.0)
        largest_horizontal_step = 0.0
        for frame in range(2, 50):
            current = controller.update(snapshot, move, "drift", frame / 60.0)
            assert previous is not None and current is not None
            largest_horizontal_step = max(
                largest_horizontal_step,
                abs(previous.position[0] - current.position[0]),
            )
            previous = current

        self.assertLess(largest_horizontal_step, 40.0)

    def test_sprite_scale_smooths_landmark_source_changes(self) -> None:
        controller = MotionController()
        command = MovementCommand(target_anchor="right_hip")
        large = self._snapshot(body_scale_px=240.0, anchors={"right_hip": (500, 350)})
        small = self._snapshot(body_scale_px=140.0, anchors={"right_hip": (500, 350)})
        before = controller.update(large, command, "hover", 0.0)
        after = controller.update(small, command, "hover", 1.0 / 30.0)

        assert before is not None and after is not None
        raw_small_scale = 140.0 / 230.0
        self.assertGreater(after.sprite_scale, raw_small_scale)
        self.assertLess(before.sprite_scale - after.sprite_scale, 0.08)

    def test_failed_target_resolution_cannot_hide_a_scale_jump(self) -> None:
        controller = MotionController()
        command = MovementCommand(target_anchor="nose")
        valid = self._snapshot(body_scale_px=230.0, anchors={"nose": (400, 250)})
        weak_only = self._snapshot(
            body_scale_px=414.0,
            anchors={"body_center": (400, 350)},
            confidence={"body_center": 0.0},
        )
        first = controller.update(valid, command, "hover", 0.0)
        frozen = controller.update(weak_only, command, "hover", 0.3)
        reacquired = controller.update(valid, command, "hover", 0.4)

        assert first is not None and frozen is not None and reacquired is not None
        self.assertEqual(frozen.sprite_scale, first.sprite_scale)
        self.assertEqual(reacquired.sprite_scale, frozen.sprite_scale)

    def test_target_is_clamped_to_scaled_safe_viewport_margin(self) -> None:
        controller = MotionController(safe_margin_px=40.0)
        command = MovementCommand(target_anchor="nose", offset_x=-500, offset_y=500)
        pose = controller.update(
            self._snapshot(frame_size=(640, 480), anchors={"nose": (10, 100)}),
            command,
            "hover",
            0.0,
        )
        assert pose is not None
        self.assertEqual(pose.target, (40.0, 440.0))

    def test_hop_arc_cannot_escape_safe_viewport_margin(self) -> None:
        controller = MotionController(safe_margin_px=88.0)
        first = MovementCommand(target_anchor="right_shoulder")
        move = MovementCommand(target_anchor="left_shoulder")
        snapshot = self._snapshot(
            anchors={"right_shoulder": (200, 20), "left_shoulder": (700, 20)}
        )
        controller.update(snapshot, first, "hover", 0.0)
        controller.update(snapshot, move, "jump_to_shoulder", 0.01)

        middle = controller.update(snapshot, move, "jump_to_shoulder", 0.25)

        assert middle is not None
        self.assertGreaterEqual(middle.position[1], 88.0)

    def test_interrupting_hop_preserves_visible_position_continuity(self) -> None:
        controller = MotionController()
        right = MovementCommand(target_anchor="right_shoulder")
        left = MovementCommand(target_anchor="left_shoulder")
        center = MovementCommand(target_anchor="nose")
        snapshot = self._snapshot(
            anchors={
                "right_shoulder": (200, 330),
                "left_shoulder": (700, 330),
                "nose": (450, 280),
            }
        )
        controller.update(snapshot, right, "hover", 0.0)
        controller.update(snapshot, left, "jump_to_shoulder", 0.01)
        before = controller.update(snapshot, left, "jump_to_shoulder", 0.20)

        after = controller.update(snapshot, center, "jump_to_shoulder", 0.2167)

        assert before is not None and after is not None
        self.assertLess(math.dist(before.position, after.position), 40.0)

    def test_tracking_loss_mid_hop_reacquires_without_jump(self) -> None:
        controller = MotionController()
        right = MovementCommand(target_anchor="right_shoulder")
        left = MovementCommand(target_anchor="left_shoulder")
        snapshot = self._snapshot(
            anchors={"right_shoulder": (200, 330), "left_shoulder": (700, 330)}
        )
        controller.update(snapshot, right, "hover", 0.0)
        controller.update(snapshot, left, "jump_to_shoulder", 0.01)
        before_loss = controller.update(snapshot, left, "jump_to_shoulder", 0.20)
        frozen = controller.update(self._snapshot(), left, "jump_to_shoulder", 0.25)

        reacquired = controller.update(snapshot, left, "jump_to_shoulder", 0.55)

        assert before_loss is not None and frozen is not None and reacquired is not None
        self.assertEqual(frozen.position, before_loss.position)
        self.assertLess(math.dist(frozen.position, reacquired.position), 50.0)


if __name__ == "__main__":
    unittest.main()
