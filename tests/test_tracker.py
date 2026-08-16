"""Unit tests for tracker state that do not require a camera or model graph."""

from __future__ import annotations

import unittest
from types import SimpleNamespace
from unittest import mock

from src.core.models import TrackingSnapshot
from src.cv.tracker import GestureTracker


class ActiveHandTrackingTests(unittest.TestCase):
    @staticmethod
    def _tracker() -> GestureTracker:
        tracker = object.__new__(GestureTracker)
        tracker.body_mapper = SimpleNamespace(hold_seconds=0.20)
        tracker._active_palm = None
        tracker._active_palm_at = None
        tracker._active_hand_side = None
        tracker._active_hand_at = None
        tracker.point_started_at = None
        tracker.open_palm_started_at = None
        tracker.last_event_at = {}
        tracker.config = {
            "gestures": {
                "point_hold_ms": 0,
                "open_palm_hold_ms": 0,
            }
        }
        return tracker

    @staticmethod
    def _hand(*, pointing: bool, direction: str = "right"):
        landmarks = [SimpleNamespace(x=0.5, y=0.5) for _ in range(21)]
        landmarks[0] = SimpleNamespace(x=0.5, y=0.7)
        landmarks[6] = SimpleNamespace(x=0.55, y=0.45)
        landmarks[8] = SimpleNamespace(
            x=0.75 if direction == "right" else 0.25,
            y=0.25 if pointing else 0.65,
        )
        for tip, pip in ((12, 10), (16, 14), (20, 18)):
            landmarks[pip] = SimpleNamespace(x=0.5, y=0.45)
            landmarks[tip] = SimpleNamespace(x=0.5, y=0.65)
        return landmarks

    def test_opposite_hand_does_not_replace_active_hand_during_dropout_hold(self) -> None:
        tracker = self._tracker()
        left = object()
        right = object()
        selected, side = tracker._select_active_hand(left, right, now=1.0)
        self.assertIs(selected, right)
        self.assertEqual(side, "right")

        selected, side = tracker._select_active_hand(left, None, now=1.1)

        self.assertIsNone(selected)
        self.assertEqual(side, "right")

    def test_switching_hands_after_hold_resets_palm_smoothing(self) -> None:
        tracker = self._tracker()
        left = object()
        right = object()
        tracker._select_active_hand(left, right, now=1.0)
        tracker._active_palm = (500.0, 200.0)
        tracker._active_palm_at = 1.0

        selected, side = tracker._select_active_hand(left, None, now=1.25)

        self.assertIs(selected, left)
        self.assertEqual(side, "left")
        self.assertIsNone(tracker._active_palm)

    def test_active_palm_fallback_prefers_same_side_wrist(self) -> None:
        tracking = TrackingSnapshot(
            frame_size=(640, 480),
            active_hand="left",
            pose_anchors={
                "left_wrist": (140, 220),
                "right_wrist": (500, 220),
            },
        )

        self.assertEqual(tracking.resolve_anchor("active_palm"), (140, 220))

    def test_active_palm_never_crosses_to_the_opposite_arm(self) -> None:
        tracking = TrackingSnapshot(
            frame_size=(640, 480),
            active_hand="left",
            pose_anchors={"right_wrist": (500, 220), "right_elbow": (470, 260)},
        )

        self.assertIsNone(tracking.resolve_anchor("active_palm"))
        self.assertIsNone(tracking.resolve_anchor("pointing_target"))

    def test_hand_identity_survives_full_hand_landmark_loss(self) -> None:
        tracker = self._tracker()
        left = object()
        tracker._select_active_hand(left, None, now=1.0)

        selected, side = tracker._select_active_hand(None, None, now=2.0)

        self.assertIsNone(selected)
        self.assertEqual(side, "left")

    def test_gesturing_hand_takes_ownership_when_both_hands_are_visible(self) -> None:
        tracker = self._tracker()
        left = self._hand(pointing=True)
        right = self._hand(pointing=False)
        tracker._select_active_hand(None, right, now=1.0)

        gesture_side = tracker._gesture_candidate_side(left, right)
        selected, side = tracker._select_active_hand(
            left,
            right,
            now=1.1,
            preferred_side=gesture_side,
        )

        self.assertIs(selected, left)
        self.assertEqual(side, "left")
        self.assertIsNone(tracker._active_palm)

    def test_opposite_hand_point_emits_against_its_own_palm_side(self) -> None:
        tracker = self._tracker()
        left = self._hand(pointing=True)
        right = self._hand(pointing=False)
        tracker._select_active_hand(None, right, now=1.0)
        side = tracker._gesture_candidate_side(left, right)
        selected, side = tracker._select_active_hand(
            left,
            right,
            now=1.1,
            preferred_side=side,
        )
        tracker.point_started_at = ("point_right", 1.0)

        with mock.patch("src.cv.tracker.time.monotonic", return_value=2.1):
            event = tracker._detect_point(selected, side, 640, 480)

        self.assertIsNotNone(event)
        assert event is not None
        self.assertEqual(event.metadata["hand"], "left")

    def test_switching_gesture_hands_resets_single_hand_hold_timers(self) -> None:
        tracker = self._tracker()
        left = self._hand(pointing=True)
        right = self._hand(pointing=True)
        tracker._select_active_hand(None, right, now=1.0)
        tracker.point_started_at = ("point_right", 1.0)
        tracker.open_palm_started_at = 1.0

        selected, side = tracker._select_active_hand(
            left,
            right,
            now=1.4,
            preferred_side="left",
        )

        self.assertIs(selected, left)
        self.assertEqual(side, "left")
        self.assertIsNone(tracker.point_started_at)
        self.assertIsNone(tracker.open_palm_started_at)

    def test_point_event_reports_the_selected_hand(self) -> None:
        tracker = self._tracker()
        left = self._hand(pointing=True, direction="right")
        tracker._select_active_hand(left, None, now=1.0)
        tracker.point_started_at = ("point_right", 1.0)

        with mock.patch("src.cv.tracker.time.monotonic", return_value=2.1):
            event = tracker._detect_point(left, "left", 640, 480)

        self.assertIsNotNone(event)
        assert event is not None
        self.assertEqual(event.name, "point_right")
        self.assertEqual(event.metadata["hand"], "left")


if __name__ == "__main__":
    unittest.main()
