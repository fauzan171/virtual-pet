"""Frame-rate independent placement and movement for the rendered pet.

This module deliberately has no OpenCV dependency.  It turns noisy tracking
snapshots into a small immutable pose that any renderer can consume.
"""

from __future__ import annotations

from dataclasses import dataclass
import math

from src.core.models import MOVEMENT_ANCHOR_NAMES, MovementCommand, TrackingSnapshot


DESIGN_BODY_SCALE_PX = 230.0
MIN_SPRITE_SCALE = 0.55
MAX_SPRITE_SCALE = 1.8

# Rates are continuous-time response constants (1 / seconds), rather than
# frame-by-frame blend factors.  This makes a one-second move feel the same at
# 15, 30, and 60 FPS.
RESPONSE_RATES: dict[str, float] = {
    "dash": 12.0,
    "jump_to_shoulder": 9.0,
    "spawn_burst": 8.0,
    "happy_spin": 7.0,
    "bounce": 6.5,
    "orbit": 6.0,
    "perch": 5.8,
    "supernova": 5.5,
    "hover": 5.0,
    "drift": 3.6,
    "peek": 3.2,
}
DEFAULT_RESPONSE_RATE = 5.0

HOP_HEIGHT_RATIOS: dict[str, float] = {
    "jump_to_shoulder": 0.22,
    "dash": 0.16,
    "bounce": 0.15,
    "happy_spin": 0.13,
    "spawn_burst": 0.12,
    "orbit": 0.10,
    "perch": 0.10,
    "hover": 0.08,
    "peek": 0.07,
    "drift": 0.06,
}
DEFAULT_HOP_HEIGHT_RATIO = 0.08


@dataclass(frozen=True, slots=True)
class MotionPose:
    """One renderer-ready pet pose.

    ``position`` includes the temporary hop arc while ``target`` is the
    clamped anatomical destination.  ``tracking_state`` is one of ``direct``,
    ``held``, ``fallback``, or ``frozen``.
    """

    position: tuple[float, float]
    speed_px_s: float
    sprite_scale: float
    resolved_anchor: str
    tracking_state: str
    target: tuple[float, float]


@dataclass(frozen=True, slots=True)
class _Hop:
    started_at: float
    duration_s: float
    height_px: float
    command_key: tuple[str, int, int, float]


class MotionController:
    """Resolve tracking anchors and smooth the pet in continuous time."""

    def __init__(
        self,
        *,
        direct_confidence: float = 0.5,
        dropout_hold_s: float = 0.25,
        max_dt_s: float = 0.1,
        safe_margin_px: float = 88.0,
        reference_body_scale_px: float = DESIGN_BODY_SCALE_PX,
        min_sprite_scale: float = MIN_SPRITE_SCALE,
        max_sprite_scale: float = MAX_SPRITE_SCALE,
        scale_response_rate: float = 4.0,
    ) -> None:
        self.direct_confidence = max(0.0, min(1.0, float(direct_confidence)))
        self.dropout_hold_s = max(0.0, float(dropout_hold_s))
        self.max_dt_s = max(0.0, float(max_dt_s))
        self.safe_margin_px = max(0.0, float(safe_margin_px))
        self.reference_body_scale_px = max(1.0, float(reference_body_scale_px))
        self.min_sprite_scale = max(0.05, float(min_sprite_scale))
        self.max_sprite_scale = max(self.min_sprite_scale, float(max_sprite_scale))
        self.scale_response_rate = max(0.0, float(scale_response_rate))

        # `_position` never contains an arc displacement.  Keeping the arc out
        # of feedback state prevents repeated hops from accumulating vertical
        # drift.
        self._position: tuple[float, float] | None = None
        self._last_pose: MotionPose | None = None
        self._last_now: float | None = None
        self._command_key: tuple[str, int, int, float] | None = None
        self._hop: _Hop | None = None
        self._resume_from_freeze = False

        self._last_direct_target: tuple[float, float] | None = None
        self._last_direct_at: float | None = None
        self._last_direct_key: tuple[str, int, int] | None = None
        self._sprite_scale_value: float | None = None

    def update(
        self,
        tracking: TrackingSnapshot | None,
        command: MovementCommand,
        animation: str,
        now: float,
    ) -> MotionPose | None:
        """Advance motion using an explicit monotonic timestamp.

        The explicit clock keeps tests deterministic and lets callers use the
        camera/render clock they already own.  Before the first usable anchor
        there is no pose; after that, complete tracking loss freezes the last
        visible pose instead of making the pet disappear.
        """

        current_time = self._finite_time(now)
        raw_dt = self._elapsed_since_last_update(current_time)

        if tracking is None or not self._has_any_anchor(tracking):
            return self._frozen_pose()

        # Time spent without tracking must not be interpreted as movement
        # time.  The first valid frame resumes exactly where the user last saw
        # the pet; normal continuous-time smoothing continues next frame.
        if self._resume_from_freeze:
            raw_dt = 0.0
            self._resume_from_freeze = False

        target_sprite_scale = self._sprite_scale(tracking.body_scale_px)
        sprite_scale = self._smooth_sprite_scale(target_sprite_scale, raw_dt)
        resolved = self._resolve_target(tracking, command, sprite_scale, current_time)
        if resolved is None:
            return self._frozen_pose()

        target, tracking_state = resolved
        command_key = self._command_identity(command)

        if self._position is None:
            self._position = target
            self._command_key = command_key
            self._hop = None
        else:
            if command_key != self._command_key:
                # Fold the currently visible (possibly arced) pose back into
                # the un-arced controller before retargeting.  Otherwise a new
                # command cancels the old arc in one frame and drops the pet.
                if self._last_pose is not None:
                    self._position = self._last_pose.position
                self._begin_hop(command_key, target, animation, command.speed, sprite_scale, current_time)
                self._command_key = command_key

            response_dt = min(raw_dt, self.max_dt_s)
            rate = RESPONSE_RATES.get(animation, DEFAULT_RESPONSE_RATE)
            speed_factor = max(0.0, float(command.speed))
            alpha = -math.expm1(-rate * speed_factor * response_dt)
            self._position = (
                self._position[0] + (target[0] - self._position[0]) * alpha,
                self._position[1] + (target[1] - self._position[1]) * alpha,
            )

        arc = self._hop_arc(command_key, current_time)
        position = self._clamp_to_viewport(
            (self._position[0], self._position[1] - arc),
            tracking.frame_size,
            sprite_scale,
        )
        speed_px_s = self._visible_speed(position, raw_dt)
        pose = MotionPose(
            position=position,
            speed_px_s=speed_px_s,
            sprite_scale=sprite_scale,
            resolved_anchor=command.target_anchor,
            tracking_state=tracking_state,
            target=target,
        )
        self._last_pose = pose
        return pose

    def _elapsed_since_last_update(self, now: float) -> float:
        if self._last_now is None:
            elapsed = 0.0
        else:
            elapsed = max(0.0, now - self._last_now)
        self._last_now = now
        return elapsed

    def _resolve_target(
        self,
        tracking: TrackingSnapshot,
        command: MovementCommand,
        sprite_scale: float,
        now: float,
    ) -> tuple[tuple[float, float], str] | None:
        anchor_name = command.target_anchor
        placement_key = (anchor_name, command.offset_x, command.offset_y)
        direct = tracking.anchor(anchor_name, min_confidence=self.direct_confidence)

        if direct is not None:
            target = self._target_from_anchor(tracking, direct, command, sprite_scale)
            self._last_direct_target = target
            self._last_direct_at = now
            self._last_direct_key = placement_key
            return target, "direct"

        if (
            self._last_direct_target is not None
            and self._last_direct_at is not None
            and self._last_direct_key == placement_key
            and max(0.0, now - self._last_direct_at) <= self.dropout_hold_s
        ):
            return self._last_direct_target, "held"

        # Use the canonical same-area fallback graph from TrackingSnapshot.
        # The same threshold deliberately rejects a weak requested landmark
        # instead of letting resolve_anchor immediately accept it again.
        fallback = tracking.resolve_anchor(anchor_name, min_confidence=self.direct_confidence)
        if fallback is None:
            return None
        target = self._target_from_anchor(tracking, fallback, command, sprite_scale)
        return target, "fallback"

    def _target_from_anchor(
        self,
        tracking: TrackingSnapshot,
        anchor: tuple[int, int],
        command: MovementCommand,
        sprite_scale: float,
    ) -> tuple[float, float]:
        # The resolver always returns a raw anatomical point.  Apply the
        # design-space offset exactly here, once, including wrist fallbacks.
        x = float(anchor[0]) + float(command.offset_x) * sprite_scale
        y = float(anchor[1]) + float(command.offset_y) * sprite_scale
        return self._clamp_to_viewport((x, y), tracking.frame_size, sprite_scale)

    def _clamp_to_viewport(
        self,
        target: tuple[float, float],
        frame_size: tuple[int, int],
        sprite_scale: float,
    ) -> tuple[float, float]:
        width = max(0.0, float(frame_size[0]))
        height = max(0.0, float(frame_size[1]))
        margin = self.safe_margin_px * sprite_scale

        def clamp_axis(value: float, extent: float) -> float:
            if extent <= margin * 2.0:
                return extent * 0.5
            return min(extent - margin, max(margin, value))

        return clamp_axis(target[0], width), clamp_axis(target[1], height)

    def _begin_hop(
        self,
        command_key: tuple[str, int, int, float],
        target: tuple[float, float],
        animation: str,
        command_speed: float,
        sprite_scale: float,
        now: float,
    ) -> None:
        if self._position is None:
            return
        distance = math.hypot(target[0] - self._position[0], target[1] - self._position[1])
        ratio = HOP_HEIGHT_RATIOS.get(animation, DEFAULT_HOP_HEIGHT_RATIO)
        height = min(56.0 * sprite_scale, distance * ratio)
        if height <= 1e-6:
            self._hop = None
            return
        speed = max(0.25, float(command_speed))
        duration = min(0.55, max(0.28, distance / (900.0 * speed)))
        self._hop = _Hop(now, duration, height, command_key)

    def _hop_arc(
        self,
        command_key: tuple[str, int, int, float],
        now: float,
    ) -> float:
        hop = self._hop
        if hop is None or hop.command_key != command_key:
            return 0.0
        progress = max(0.0, now - hop.started_at) / hop.duration_s
        if progress >= 1.0:
            # The visual arc ends exactly at zero, while the un-arced base keeps
            # following the continuous-time controller.  Snapping the base to
            # a live target here creates a large one-frame teleport.
            self._hop = None
            return 0.0
        return hop.height_px * math.sin(math.pi * progress)

    def _visible_speed(self, position: tuple[float, float], elapsed: float) -> float:
        if self._last_pose is None or elapsed <= 0.0:
            return 0.0
        return math.hypot(
            position[0] - self._last_pose.position[0],
            position[1] - self._last_pose.position[1],
        ) / elapsed

    def _frozen_pose(self) -> MotionPose | None:
        if self._last_pose is None:
            return None
        # Freeze the visible pose, not the hidden un-arced base.  Cancelling the
        # hop here makes later reacquisition continue from exactly what the user
        # last saw instead of letting the arc expire off-screen.
        self._position = self._last_pose.position
        self._hop = None
        self._resume_from_freeze = True
        # Target resolution can fail after scale smoothing has already run.
        # Rebase the hidden controller value to the scale that actually stayed
        # on screen, so reacquisition cannot reveal an unseen scale jump.
        self._sprite_scale_value = self._last_pose.sprite_scale
        frozen = MotionPose(
            position=self._last_pose.position,
            speed_px_s=0.0,
            sprite_scale=self._last_pose.sprite_scale,
            resolved_anchor=self._last_pose.resolved_anchor,
            tracking_state="frozen",
            target=self._last_pose.target,
        )
        self._last_pose = frozen
        return frozen

    @staticmethod
    def _command_identity(command: MovementCommand) -> tuple[str, int, int, float]:
        return (
            command.target_anchor,
            command.offset_x,
            command.offset_y,
            float(command.speed),
        )

    def _sprite_scale(self, body_scale_px: float) -> float:
        scale = float(body_scale_px) / self.reference_body_scale_px
        if not math.isfinite(scale):
            scale = 1.0
        return min(self.max_sprite_scale, max(self.min_sprite_scale, scale))

    def _smooth_sprite_scale(self, target: float, elapsed: float) -> float:
        if self._sprite_scale_value is None:
            self._sprite_scale_value = target
            return target
        dt = min(max(0.0, elapsed), self.max_dt_s)
        alpha = -math.expm1(-self.scale_response_rate * dt)
        self._sprite_scale_value += (target - self._sprite_scale_value) * alpha
        return self._sprite_scale_value

    @staticmethod
    def _finite_time(now: float) -> float:
        value = float(now)
        if not math.isfinite(value):
            raise ValueError("now must be finite")
        return value

    @staticmethod
    def _has_any_anchor(tracking: TrackingSnapshot) -> bool:
        if any(point is not None for point in tracking.pose_anchors.values()):
            return True
        return any(tracking.anchor(name) is not None for name in MOVEMENT_ANCHOR_NAMES)
