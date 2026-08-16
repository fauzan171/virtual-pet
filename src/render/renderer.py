"""OpenCV renderer for the HoloPet experience."""

from __future__ import annotations

import math
import time

import cv2
import numpy as np

from src.core.models import PetExpression, TrackingSnapshot
from src.render.cartoon_sheet import CartoonPetSheet, composite_sprite
from src.render.motion import MotionController, MotionPose


class HoloPetRenderer:
    def __init__(
        self,
        subtitle_y_offset: int = 60,
        skin: str = "fox",
        motion_config: dict | None = None,
    ) -> None:
        self.subtitle_y_offset = subtitle_y_offset
        self._start_time = time.monotonic()
        self._sheet = CartoonPetSheet(frame_size=192, skin=skin)
        motion_config = motion_config or {}
        self._motion = MotionController(
            direct_confidence=float(motion_config.get("min_anchor_confidence", 0.25)),
            dropout_hold_s=float(motion_config.get("anchor_hold_ms", 250)) / 1000.0,
            max_dt_s=float(motion_config.get("max_frame_gap_ms", 100)) / 1000.0,
            safe_margin_px=float(motion_config.get("safe_margin_px", 88)),
            reference_body_scale_px=float(motion_config.get("reference_body_scale_px", 230)),
            min_sprite_scale=float(motion_config.get("min_body_scale", 0.55)),
            max_sprite_scale=float(motion_config.get("max_body_scale", 1.8)),
        )
        self._last_motion: MotionPose | None = None

    def render(self, frame: np.ndarray, tracking: TrackingSnapshot, expression: PetExpression, show_debug: bool) -> np.ndarray:
        canvas = frame.copy()
        if expression.state != "hidden":
            self._last_motion = self._motion.update(
                tracking,
                expression.movement,
                expression.animation,
                now=time.monotonic(),
            )
            if self._last_motion is not None:
                center = (
                    int(round(self._last_motion.position[0])),
                    int(round(self._last_motion.position[1])),
                )
                self._draw_pet(canvas, center, expression, self._last_motion)
        self._draw_hud(canvas, tracking, expression)
        if show_debug:
            self._draw_debug(canvas, tracking, self._last_motion)
        return canvas

    def _draw_pet(
        self,
        canvas: np.ndarray,
        center: tuple[int, int],
        expression: PetExpression,
        motion: MotionPose,
    ) -> None:
        t = time.monotonic() - self._start_time
        bob = int(math.sin(t * 2.5) * (6 + expression.energy * 10) * motion.sprite_scale)
        normalized_motion = min(3.0, motion.speed_px_s / 180.0)
        sprite = self._sheet.frame(expression, t, motion_speed=normalized_motion)
        scale = (0.82 + expression.energy * 0.18 + expression.bond_level * 0.015) * motion.sprite_scale
        if expression.state == "evolved":
            scale += 0.08

        height, width = canvas.shape[:2]
        design_margin = int(round(self._motion.safe_margin_px * motion.sprite_scale))
        margin_x = max(design_margin, int(math.ceil(sprite.shape[1] * scale * 0.5)))
        margin_y = max(design_margin, int(math.ceil(sprite.shape[0] * scale * 0.5)))
        center = (
            min(width - margin_x, max(margin_x, center[0])) if width > margin_x * 2 else width // 2,
            min(height - margin_y, max(margin_y, center[1] + bob)) if height > margin_y * 2 else height // 2,
        )
        self._draw_particles(canvas, center, 48, expression.color, expression, t)
        composite_sprite(canvas, sprite, center, scale=scale)

    def _draw_particles(
        self,
        canvas: np.ndarray,
        center: tuple[int, int],
        radius: int,
        color: tuple[int, int, int],
        expression: PetExpression,
        t: float,
    ) -> None:
        orbit_count = 4 if expression.state != "evolved" else 7
        orbit_radius = radius + 36 + int(expression.energy * 24)
        for idx in range(orbit_count):
            angle = t * (1.6 + expression.energy) + idx * (2 * math.pi / orbit_count)
            px = int(center[0] + math.cos(angle) * orbit_radius)
            py = int(center[1] + math.sin(angle) * (orbit_radius * 0.55))
            size = 3 if idx % 2 == 0 else 2
            cv2.circle(canvas, (px, py), size, color, thickness=-1, lineType=cv2.LINE_AA)

    def _draw_hud(self, canvas: np.ndarray, tracking: TrackingSnapshot, expression: PetExpression) -> None:
        height, width = canvas.shape[:2]
        overlay = canvas.copy()
        cv2.rectangle(overlay, (18, 18), (width - 18, 90), (10, 24, 34), thickness=-1)
        cv2.addWeighted(overlay, 0.35, canvas, 0.65, 0, dst=canvas)
        cv2.putText(canvas, "HOLOPET // INTERACTIVE CAMERA DEMO", (32, 50), cv2.FONT_HERSHEY_SIMPLEX, 0.7, (130, 250, 255), 2, cv2.LINE_AA)
        cv2.putText(canvas, f"STATE: {expression.state.upper()}", (32, 77), cv2.FONT_HERSHEY_SIMPLEX, 0.55, expression.color, 2, cv2.LINE_AA)
        cv2.putText(canvas, f"MOOD: {expression.mood.upper()}  BOND: {expression.bond_level}/5", (420, 77), cv2.FONT_HERSHEY_SIMPLEX, 0.55, (220, 245, 255), 2, cv2.LINE_AA)
        source = expression.response_source
        if source == "remote":
            source_label, source_color = "REMOTE", (140, 240, 255)
        elif source == "fallback":
            source_label, source_color = "FALLBACK (LOKAL)", (255, 200, 120)
        else:
            source_label, source_color = source.upper(), (200, 238, 255)
        cv2.putText(canvas, f"BRAIN: {source_label}", (32, 102), cv2.FONT_HERSHEY_SIMPLEX, 0.5, source_color, 1, cv2.LINE_AA)

        bar_x0 = width - 260
        bar_x1 = width - 40
        bar_y0 = 36
        cv2.rectangle(canvas, (bar_x0, bar_y0), (bar_x1, bar_y0 + 16), (30, 52, 68), thickness=1)
        fill_x = bar_x0 + int((bar_x1 - bar_x0 - 2) * expression.energy)
        cv2.rectangle(canvas, (bar_x0 + 1, bar_y0 + 1), (fill_x, bar_y0 + 15), expression.color, thickness=-1)
        cv2.putText(canvas, "ENERGY", (bar_x0, bar_y0 - 8), cv2.FONT_HERSHEY_SIMPLEX, 0.45, (200, 238, 255), 1, cv2.LINE_AA)

        box_h = 70
        y0 = height - self.subtitle_y_offset - box_h
        overlay = canvas.copy()
        cv2.rectangle(overlay, (20, y0), (width - 20, y0 + box_h), (10, 18, 26), thickness=-1)
        cv2.addWeighted(overlay, 0.55, canvas, 0.45, 0, dst=canvas)
        cv2.putText(canvas, expression.subtitle, (36, y0 + 42), cv2.FONT_HERSHEY_SIMPLEX, 0.8, (235, 248, 255), 2, cv2.LINE_AA)

    def _draw_debug(
        self,
        canvas: np.ndarray,
        tracking: TrackingSnapshot,
        motion: MotionPose | None,
    ) -> None:
        points = set(tracking.pose_anchors.values())
        if tracking.active_palm is not None:
            points.add(tracking.active_palm)
        if tracking.pointing_target is not None:
            points.add(tracking.pointing_target)
        for point in points:
            cv2.circle(canvas, point, 5, (0, 255, 255), thickness=-1, lineType=cv2.LINE_AA)
        if tracking.body_bounds is not None:
            x0, y0, x1, y1 = tracking.body_bounds
            cv2.rectangle(canvas, (x0, y0), (x1, y1), (255, 190, 70), 2, cv2.LINE_AA)
        if motion is not None:
            target = (int(round(motion.target[0])), int(round(motion.target[1])))
            cv2.drawMarker(canvas, target, (255, 80, 255), cv2.MARKER_CROSS, 18, 2, cv2.LINE_AA)
        y = 126
        cv2.putText(canvas, f"confidence: {tracking.tracking_confidence:.2f}", (28, y), cv2.FONT_HERSHEY_SIMPLEX, 0.5, (255, 255, 255), 1, cv2.LINE_AA)
        if motion is not None:
            y += 22
            cv2.putText(
                canvas,
                f"motion: {motion.tracking_state} -> {motion.resolved_anchor}",
                (28, y),
                cv2.FONT_HERSHEY_SIMPLEX,
                0.48,
                (255, 210, 255),
                1,
                cv2.LINE_AA,
            )
        for key, value in tracking.debug.items():
            y += 22
            cv2.putText(canvas, f"{key}: {value}", (28, y), cv2.FONT_HERSHEY_SIMPLEX, 0.48, (210, 230, 255), 1, cv2.LINE_AA)
