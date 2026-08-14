"""MediaPipe-based tracking and gesture heuristics."""

from __future__ import annotations

import math
import time
from collections import deque
from dataclasses import dataclass

import cv2
import mediapipe as mp
import numpy as np

from src.core.models import InteractionEvent, TrackingSnapshot


@dataclass(slots=True)
class _LandmarkPoint:
    x: float
    y: float
    visibility: float = 1.0


class GestureTracker:
    """Tracks user landmarks and emits simple stage-safe interaction events."""

    def __init__(self, config: dict) -> None:
        self.config = config
        self.holistic = mp.solutions.holistic.Holistic(
            min_detection_confidence=0.5,
            min_tracking_confidence=0.5,
            model_complexity=1,
            refine_face_landmarks=True,
        )
        self.wave_history: deque[float] = deque(maxlen=18)
        self.open_palm_started_at: float | None = None
        self.point_started_at: tuple[str, float] | None = None
        self.two_hand_started_at: float | None = None
        self.baseline_shoulder_width: float | None = None
        self.last_event_at: dict[str, float] = {}

    def close(self) -> None:
        self.holistic.close()

    def process(self, frame: np.ndarray) -> TrackingSnapshot:
        rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
        results = self.holistic.process(rgb)
        height, width = frame.shape[:2]
        snapshot = TrackingSnapshot(frame_size=(width, height))

        pose = results.pose_landmarks.landmark if results.pose_landmarks else None
        face = results.face_landmarks.landmark if results.face_landmarks else None
        left_hand = results.left_hand_landmarks.landmark if results.left_hand_landmarks else None
        right_hand = results.right_hand_landmarks.landmark if results.right_hand_landmarks else None

        if pose:
            snapshot.nose = self._px(pose[mp.solutions.holistic.PoseLandmark.NOSE.value], width, height)
            snapshot.left_shoulder = self._px(pose[mp.solutions.holistic.PoseLandmark.LEFT_SHOULDER.value], width, height)
            snapshot.right_shoulder = self._px(pose[mp.solutions.holistic.PoseLandmark.RIGHT_SHOULDER.value], width, height)
            snapshot.left_wrist = self._px(pose[mp.solutions.holistic.PoseLandmark.LEFT_WRIST.value], width, height)
            snapshot.right_wrist = self._px(pose[mp.solutions.holistic.PoseLandmark.RIGHT_WRIST.value], width, height)
            snapshot.tracking_confidence = float(
                np.mean(
                    [
                        pose[mp.solutions.holistic.PoseLandmark.LEFT_SHOULDER.value].visibility,
                        pose[mp.solutions.holistic.PoseLandmark.RIGHT_SHOULDER.value].visibility,
                    ]
                )
            )

        if right_hand:
            snapshot.active_palm = self._hand_center(right_hand, width, height)
        elif left_hand:
            snapshot.active_palm = self._hand_center(left_hand, width, height)

        if face:
            snapshot.smile_score = self._smile_score(face)

        event = (
            self._detect_wave(pose)
            or self._detect_open_palm(left_hand, right_hand)
            or self._detect_point(pose, left_hand, right_hand, width, height)
            or self._detect_lean_in(snapshot)
            or self._detect_smile(snapshot)
            or self._detect_two_hand_pose(pose, left_hand, right_hand)
        )
        snapshot.fired_event = event

        if event and event.name.startswith("point_") and snapshot.active_palm:
            dx = -180 if event.name == "point_left" else 180
            snapshot.pointing_target = (snapshot.active_palm[0] + dx, snapshot.active_palm[1] - 30)

        snapshot.debug = {
            "event": event.name if event else "-",
            "smile": f"{snapshot.smile_score:.2f}",
            "baseline_shoulder": f"{self.baseline_shoulder_width:.1f}" if self.baseline_shoulder_width else "unset",
        }
        return snapshot

    def _detect_wave(self, pose) -> InteractionEvent | None:
        if not pose:
            self.wave_history.clear()
            return None
        wrist = pose[mp.solutions.holistic.PoseLandmark.RIGHT_WRIST.value]
        elbow = pose[mp.solutions.holistic.PoseLandmark.RIGHT_ELBOW.value]
        shoulder = pose[mp.solutions.holistic.PoseLandmark.RIGHT_SHOULDER.value]
        if wrist.visibility < 0.5 or elbow.visibility < 0.5 or shoulder.visibility < 0.5:
            self.wave_history.clear()
            return None
        if wrist.y > shoulder.y:
            self.wave_history.clear()
            return None
        self.wave_history.append(wrist.x)
        if len(self.wave_history) < self.config["gestures"]["wave_min_frames"]:
            return None
        amplitude = max(self.wave_history) - min(self.wave_history)
        direction_changes = 0
        last_sign = 0
        values = list(self.wave_history)
        for prev, cur in zip(values, values[1:]):
            sign = 1 if cur > prev else -1
            if last_sign and sign != last_sign:
                direction_changes += 1
            last_sign = sign
        if amplitude > 0.12 and direction_changes >= 2 and self._cooldown_ready("wave", 1.2):
            self._mark_event("wave")
            return InteractionEvent(name="wave", confidence=0.92)
        return None

    def _detect_open_palm(self, left_hand, right_hand) -> InteractionEvent | None:
        hand = right_hand or left_hand
        if hand is None:
            self.open_palm_started_at = None
            return None
        if not self._is_open_palm(hand):
            self.open_palm_started_at = None
            return None
        now = time.monotonic()
        if self.open_palm_started_at is None:
            self.open_palm_started_at = now
            return None
        hold_ms = (now - self.open_palm_started_at) * 1000
        if hold_ms >= self.config["gestures"]["open_palm_hold_ms"] and self._cooldown_ready("open_palm", 1.2):
            self._mark_event("open_palm")
            self.open_palm_started_at = None
            return InteractionEvent(name="open_palm", confidence=0.88)
        return None

    def _detect_point(self, pose, left_hand, right_hand, width: int, height: int) -> InteractionEvent | None:
        hand_name = None
        hand = None
        if right_hand and self._is_pointing(right_hand):
            hand_name = "right"
            hand = right_hand
        elif left_hand and self._is_pointing(left_hand):
            hand_name = "left"
            hand = left_hand
        if hand is None:
            self.point_started_at = None
            return None
        wrist = self._px(hand[0], width, height)
        index_tip = self._px(hand[8], width, height)
        direction = "point_right" if index_tip[0] > wrist[0] else "point_left"
        now = time.monotonic()
        if not self.point_started_at or self.point_started_at[0] != direction:
            self.point_started_at = (direction, now)
            return None
        hold_ms = (now - self.point_started_at[1]) * 1000
        if hold_ms >= self.config["gestures"]["point_hold_ms"] and self._cooldown_ready(direction, 1.0):
            self._mark_event(direction)
            self.point_started_at = None
            return InteractionEvent(name=direction, confidence=0.83)
        return None

    def _detect_lean_in(self, snapshot: TrackingSnapshot) -> InteractionEvent | None:
        if not snapshot.left_shoulder or not snapshot.right_shoulder:
            return None
        current_width = abs(snapshot.right_shoulder[0] - snapshot.left_shoulder[0])
        if self.baseline_shoulder_width is None:
            self.baseline_shoulder_width = current_width
            return None
        self.baseline_shoulder_width = self.baseline_shoulder_width * 0.97 + current_width * 0.03
        if current_width > self.baseline_shoulder_width * self.config["gestures"]["lean_in_ratio"] and self._cooldown_ready("lean_in", 1.5):
            self._mark_event("lean_in")
            return InteractionEvent(name="lean_in", confidence=0.78)
        return None

    def _detect_smile(self, snapshot: TrackingSnapshot) -> InteractionEvent | None:
        if snapshot.smile_score >= self.config["gestures"]["smile_threshold"] and self._cooldown_ready("smile", 1.5):
            self._mark_event("smile")
            return InteractionEvent(name="smile", confidence=min(1.0, snapshot.smile_score))
        return None

    def _detect_two_hand_pose(self, pose, left_hand, right_hand) -> InteractionEvent | None:
        if not pose or not left_hand or not right_hand:
            self.two_hand_started_at = None
            return None
        left_wrist = pose[mp.solutions.holistic.PoseLandmark.LEFT_WRIST.value]
        right_wrist = pose[mp.solutions.holistic.PoseLandmark.RIGHT_WRIST.value]
        left_shoulder = pose[mp.solutions.holistic.PoseLandmark.LEFT_SHOULDER.value]
        right_shoulder = pose[mp.solutions.holistic.PoseLandmark.RIGHT_SHOULDER.value]
        both_up = left_wrist.y < left_shoulder.y and right_wrist.y < right_shoulder.y
        close_x = abs(left_wrist.x - right_wrist.x) < 0.25
        if not (both_up and close_x):
            self.two_hand_started_at = None
            return None
        now = time.monotonic()
        if self.two_hand_started_at is None:
            self.two_hand_started_at = now
            return None
        hold_ms = (now - self.two_hand_started_at) * 1000
        if hold_ms >= self.config["gestures"]["two_hand_pose_hold_ms"] and self._cooldown_ready("two_hand_pose", 2.5):
            self._mark_event("two_hand_pose")
            self.two_hand_started_at = None
            return InteractionEvent(name="two_hand_pose", confidence=0.87)
        return None

    def _smile_score(self, face_landmarks) -> float:
        left = face_landmarks[61]
        right = face_landmarks[291]
        top = face_landmarks[13]
        bottom = face_landmarks[14]
        mouth_width = math.dist((left.x, left.y), (right.x, right.y))
        mouth_height = math.dist((top.x, top.y), (bottom.x, bottom.y))
        if mouth_height <= 0.001:
            return 0.0
        return mouth_width / max(mouth_height * 7.5, 0.001)

    def _is_open_palm(self, hand_landmarks) -> bool:
        fingers = ((8, 6), (12, 10), (16, 14), (20, 18))
        extended = sum(1 for tip, pip in fingers if hand_landmarks[tip].y < hand_landmarks[pip].y)
        return extended >= 4

    def _is_pointing(self, hand_landmarks) -> bool:
        index_up = hand_landmarks[8].y < hand_landmarks[6].y
        middle_down = hand_landmarks[12].y > hand_landmarks[10].y
        ring_down = hand_landmarks[16].y > hand_landmarks[14].y
        pinky_down = hand_landmarks[20].y > hand_landmarks[18].y
        return index_up and middle_down and ring_down and pinky_down

    def _hand_center(self, hand_landmarks, width: int, height: int) -> tuple[int, int]:
        xs = [lm.x for lm in hand_landmarks]
        ys = [lm.y for lm in hand_landmarks]
        return (int(np.mean(xs) * width), int(np.mean(ys) * height))

    @staticmethod
    def _px(landmark: _LandmarkPoint, width: int, height: int) -> tuple[int, int]:
        return (int(landmark.x * width), int(landmark.y * height))

    def _cooldown_ready(self, name: str, seconds: float) -> bool:
        return time.monotonic() - self.last_event_at.get(name, 0.0) >= seconds

    def _mark_event(self, name: str) -> None:
        self.last_event_at[name] = time.monotonic()
