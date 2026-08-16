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
from src.cv.body_geometry import BodyGeometryMapper, LandmarkObservation


_POSE_LANDMARKS = {
    "nose": mp.solutions.holistic.PoseLandmark.NOSE.value,
    "left_ear": mp.solutions.holistic.PoseLandmark.LEFT_EAR.value,
    "right_ear": mp.solutions.holistic.PoseLandmark.RIGHT_EAR.value,
    "left_shoulder": mp.solutions.holistic.PoseLandmark.LEFT_SHOULDER.value,
    "right_shoulder": mp.solutions.holistic.PoseLandmark.RIGHT_SHOULDER.value,
    "left_elbow": mp.solutions.holistic.PoseLandmark.LEFT_ELBOW.value,
    "right_elbow": mp.solutions.holistic.PoseLandmark.RIGHT_ELBOW.value,
    "left_wrist": mp.solutions.holistic.PoseLandmark.LEFT_WRIST.value,
    "right_wrist": mp.solutions.holistic.PoseLandmark.RIGHT_WRIST.value,
    "left_hip": mp.solutions.holistic.PoseLandmark.LEFT_HIP.value,
    "right_hip": mp.solutions.holistic.PoseLandmark.RIGHT_HIP.value,
    "left_knee": mp.solutions.holistic.PoseLandmark.LEFT_KNEE.value,
    "right_knee": mp.solutions.holistic.PoseLandmark.RIGHT_KNEE.value,
    "left_ankle": mp.solutions.holistic.PoseLandmark.LEFT_ANKLE.value,
    "right_ankle": mp.solutions.holistic.PoseLandmark.RIGHT_ANKLE.value,
    "left_heel": mp.solutions.holistic.PoseLandmark.LEFT_HEEL.value,
    "right_heel": mp.solutions.holistic.PoseLandmark.RIGHT_HEEL.value,
    "left_foot": mp.solutions.holistic.PoseLandmark.LEFT_FOOT_INDEX.value,
    "right_foot": mp.solutions.holistic.PoseLandmark.RIGHT_FOOT_INDEX.value,
}

_LEGACY_SNAPSHOT_ANCHORS = (
    "nose",
    "left_shoulder",
    "right_shoulder",
    "left_wrist",
    "right_wrist",
    "left_elbow",
    "right_elbow",
    "left_hip",
    "right_hip",
    "left_knee",
    "right_knee",
)


@dataclass(slots=True)
class _LandmarkPoint:
    x: float
    y: float
    visibility: float = 1.0


class GestureTracker:
    """Tracks user landmarks and emits simple stage-safe interaction events."""

    def __init__(self, config: dict) -> None:
        self.config = config
        tracking_config = config.get("tracking", {})
        smoothing_config = config.get("smoothing", {})
        segmentation_enabled = bool(tracking_config.get("segmentation_enabled", True))
        self.holistic = mp.solutions.holistic.Holistic(
            min_detection_confidence=0.5,
            min_tracking_confidence=0.5,
            model_complexity=1,
            refine_face_landmarks=True,
            enable_segmentation=segmentation_enabled,
            smooth_segmentation=segmentation_enabled,
        )
        self.body_mapper = BodyGeometryMapper(
            pose_alpha=float(smoothing_config.get("pose_alpha", 0.45)),
            visibility_threshold=float(tracking_config.get("visibility_threshold", 0.45)),
            hold_seconds=float(tracking_config.get("anchor_hold_ms", 220)) / 1000.0,
            mask_threshold=float(tracking_config.get("segmentation_threshold", 0.55)),
            min_mask_area_ratio=float(tracking_config.get("segmentation_min_area_ratio", 0.015)),
        )
        self.segmentation_enabled = segmentation_enabled
        self.hand_alpha = float(smoothing_config.get("hand_alpha", 0.35))
        self.face_alpha = float(smoothing_config.get("face_alpha", 0.40))
        self._active_palm: tuple[float, float] | None = None
        self._active_palm_at: float | None = None
        self._active_hand_side: str | None = None
        self._active_hand_at: float | None = None
        self._smoothed_smile = 0.0
        self._smile_at: float | None = None
        self._last_pointing_target: tuple[int, int] | None = None
        self._last_pointing_at: float | None = None
        self.wave_history: deque[float] = deque(maxlen=18)
        self.open_palm_started_at: float | None = None
        self.point_started_at: tuple[str, float] | None = None
        self.two_hand_started_at: float | None = None
        self.baseline_shoulder_width: float | None = None
        self.last_event_at: dict[str, float] = {}

    def close(self) -> None:
        self.holistic.close()

    def process(self, frame: np.ndarray) -> TrackingSnapshot:
        now = time.monotonic()
        rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
        results = self.holistic.process(rgb)
        height, width = frame.shape[:2]
        snapshot = TrackingSnapshot(frame_size=(width, height), captured_at=now)

        pose = results.pose_landmarks.landmark if results.pose_landmarks else None
        face = results.face_landmarks.landmark if results.face_landmarks else None
        left_hand = results.left_hand_landmarks.landmark if results.left_hand_landmarks else None
        right_hand = results.right_hand_landmarks.landmark if results.right_hand_landmarks else None

        if pose:
            observations = {
                name: LandmarkObservation(
                    x=float(pose[index].x),
                    y=float(pose[index].y),
                    visibility=float(pose[index].visibility),
                )
                for name, index in _POSE_LANDMARKS.items()
            }
        else:
            observations = {}

        geometry = self.body_mapper.update(
            observations,
            (width, height),
            now,
            segmentation_mask=getattr(results, "segmentation_mask", None) if self.segmentation_enabled else None,
        )
        snapshot.pose_anchors = geometry.anchors
        snapshot.anchor_confidence = geometry.anchor_confidence
        snapshot.body_bounds = geometry.body_bounds
        snapshot.body_scale_px = geometry.body_scale_px
        snapshot.full_body_visible = geometry.full_body_visible
        snapshot.tracking_confidence = geometry.tracking_confidence
        for anchor_name in _LEGACY_SNAPSHOT_ANCHORS:
            setattr(snapshot, anchor_name, geometry.anchors.get(anchor_name))

        gesture_side = self._gesture_candidate_side(left_hand, right_hand)
        selected_hand, active_hand = self._select_active_hand(
            left_hand,
            right_hand,
            now,
            preferred_side=gesture_side,
        )
        raw_palm = self._hand_center(selected_hand, width, height) if selected_hand is not None else None
        snapshot.active_palm = self._smooth_auxiliary_point(raw_palm, now)
        snapshot.active_hand = active_hand
        if snapshot.active_palm is not None:
            snapshot.anchor_confidence["active_palm"] = 1.0

        if face:
            snapshot.smile_score = self._smooth_smile(self._smile_score(face), now)

        event = (
            self._detect_wave(pose)
            or self._detect_open_palm(selected_hand, active_hand)
            or self._detect_point(selected_hand, active_hand, width, height)
            or self._detect_lean_in(snapshot)
            or self._detect_smile(snapshot)
            or self._detect_two_hand_pose(pose, left_hand, right_hand)
        )
        snapshot.fired_event = event

        if event and event.name.startswith("point_") and snapshot.active_palm:
            scale = max(0.55, min(1.8, snapshot.body_scale_px / 230.0))
            dx = int((-180 if event.name == "point_left" else 180) * scale)
            target = (
                min(width - 1, max(0, snapshot.active_palm[0] + dx)),
                min(height - 1, max(0, snapshot.active_palm[1] - int(30 * scale))),
            )
            self._last_pointing_target = target
            self._last_pointing_at = now
        if self._last_pointing_target is not None and self._last_pointing_at is not None and now - self._last_pointing_at <= 2.0:
            snapshot.pointing_target = self._last_pointing_target
            snapshot.anchor_confidence["pointing_target"] = 0.9

        snapshot.debug = {
            "event": event.name if event else "-",
            "smile": f"{snapshot.smile_score:.2f}",
            "baseline_shoulder": f"{self.baseline_shoulder_width:.1f}" if self.baseline_shoulder_width else "unset",
            "body_scale": f"{snapshot.body_scale_px:.1f}px",
            "body_bounds": str(snapshot.body_bounds or "-"),
            "bounds_source": geometry.bounds_source,
            "full_body": "yes" if snapshot.full_body_visible else "no",
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

    def _detect_open_palm(self, hand, hand_name: str | None) -> InteractionEvent | None:
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
            return InteractionEvent(
                name="open_palm",
                confidence=0.88,
                metadata={"hand": hand_name} if hand_name else {},
            )
        return None

    def _detect_point(self, hand, hand_name: str | None, width: int, height: int) -> InteractionEvent | None:
        if hand is None or not self._is_pointing(hand):
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
            return InteractionEvent(
                name=direction,
                confidence=0.83,
                metadata={"hand": hand_name} if hand_name else {},
            )
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
        return (
            min(width - 1, max(0, int(round(float(np.mean(xs)) * width)))),
            min(height - 1, max(0, int(round(float(np.mean(ys)) * height)))),
        )

    def _gesture_candidate_side(self, left_hand, right_hand) -> str | None:
        """Pick the hand currently making a single-hand gesture, if any."""

        pointing = {
            "left": left_hand is not None and self._is_pointing(left_hand),
            "right": right_hand is not None and self._is_pointing(right_hand),
        }
        for side in (self._active_hand_side, "right", "left"):
            if side and pointing.get(side, False):
                return side

        open_palms = {
            "left": left_hand is not None and self._is_open_palm(left_hand),
            "right": right_hand is not None and self._is_open_palm(right_hand),
        }
        for side in (self._active_hand_side, "right", "left"):
            if side and open_palms.get(side, False):
                return side
        return None

    def _select_active_hand(
        self,
        left_hand,
        right_hand,
        now: float,
        *,
        preferred_side: str | None = None,
    ):
        """Keep hand identity stable through a brief single-hand dropout."""

        preferred_hand = right_hand if preferred_side == "right" else left_hand
        if preferred_side in {"left", "right"} and preferred_hand is not None:
            if preferred_side != self._active_hand_side:
                # A real gesture is allowed to take ownership, but never blend
                # its coordinates with the previously active physical hand.
                self._active_palm = None
                self._active_palm_at = None
                self.point_started_at = None
                self.open_palm_started_at = None
            self._active_hand_side = preferred_side
            self._active_hand_at = now
            return preferred_hand, preferred_side

        current_hand = right_hand if self._active_hand_side == "right" else left_hand
        if self._active_hand_side in {"left", "right"} and current_hand is not None:
            self._active_hand_at = now
            return current_hand, self._active_hand_side

        if (
            self._active_hand_side in {"left", "right"}
            and self._active_hand_at is not None
            and now - self._active_hand_at <= self.body_mapper.hold_seconds
        ):
            return None, self._active_hand_side

        if right_hand is None and left_hand is None:
            # Preserve identity even after the detailed hand landmarks expire;
            # pose wrists can still provide a same-side anatomical fallback.
            return None, self._active_hand_side

        new_side = "right" if right_hand is not None else "left"
        if new_side != self._active_hand_side:
            # Never EMA-blend two different physical hands across the torso.
            self._active_palm = None
            self._active_palm_at = None
            self.point_started_at = None
            self.open_palm_started_at = None
        self._active_hand_side = new_side
        self._active_hand_at = now if new_side is not None else None
        selected = right_hand if new_side == "right" else (left_hand if new_side == "left" else None)
        return selected, new_side

    def _smooth_auxiliary_point(self, point: tuple[int, int] | None, now: float) -> tuple[int, int] | None:
        if point is None:
            if self._active_palm is None or self._active_palm_at is None:
                return None
            if now - self._active_palm_at <= self.body_mapper.hold_seconds:
                return (int(round(self._active_palm[0])), int(round(self._active_palm[1])))
            self._active_palm = None
            self._active_palm_at = None
            return None

        if self._active_palm is None or self._active_palm_at is None:
            smoothed = (float(point[0]), float(point[1]))
        else:
            alpha = self._effective_alpha(self.hand_alpha, now - self._active_palm_at)
            smoothed = (
                self._active_palm[0] + (point[0] - self._active_palm[0]) * alpha,
                self._active_palm[1] + (point[1] - self._active_palm[1]) * alpha,
            )
        self._active_palm = smoothed
        self._active_palm_at = now
        return (int(round(smoothed[0])), int(round(smoothed[1])))

    def _smooth_smile(self, score: float, now: float) -> float:
        if self._smile_at is None:
            self._smoothed_smile = score
        else:
            alpha = self._effective_alpha(self.face_alpha, now - self._smile_at)
            self._smoothed_smile += (score - self._smoothed_smile) * alpha
        self._smile_at = now
        return self._smoothed_smile

    @staticmethod
    def _effective_alpha(alpha_at_30fps: float, elapsed: float) -> float:
        alpha = min(1.0, max(0.0, float(alpha_at_30fps)))
        if elapsed <= 0.0 or alpha <= 0.0:
            return 0.0
        if alpha >= 1.0:
            return 1.0
        return 1.0 - (1.0 - alpha) ** (elapsed * 30.0)

    @staticmethod
    def _px(landmark: _LandmarkPoint, width: int, height: int) -> tuple[int, int]:
        return (
            min(width - 1, max(0, int(round(landmark.x * width)))),
            min(height - 1, max(0, int(round(landmark.y * height)))),
        )

    def _cooldown_ready(self, name: str, seconds: float) -> bool:
        return time.monotonic() - self.last_event_at.get(name, 0.0) >= seconds

    def _mark_event(self, name: str) -> None:
        self.last_event_at[name] = time.monotonic()
