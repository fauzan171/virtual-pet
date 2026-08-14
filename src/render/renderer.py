"""OpenCV renderer for the HoloPet experience."""

from __future__ import annotations

import math
import time

import cv2
import numpy as np

from src.core.models import PetExpression, TrackingSnapshot
from src.render.cartoon_sheet import CartoonPetSheet, composite_sprite


class HoloPetRenderer:
    def __init__(self, subtitle_y_offset: int = 60) -> None:
        self.subtitle_y_offset = subtitle_y_offset
        self._start_time = time.monotonic()
        self._pet_position: tuple[int, int] | None = None
        self._sheet = CartoonPetSheet(frame_size=192)

    def render(self, frame: np.ndarray, tracking: TrackingSnapshot, expression: PetExpression, show_debug: bool) -> np.ndarray:
        canvas = frame.copy()
        anchor = self._resolve_anchor(tracking, expression)
        if anchor is not None and expression.state != "hidden":
            self._pet_position = self._smooth_move(anchor, expression.movement.speed)
            self._draw_pet(canvas, self._pet_position, expression)
        self._draw_hud(canvas, tracking, expression)
        if show_debug:
            self._draw_debug(canvas, tracking)
        return canvas

    def _smooth_move(self, anchor: tuple[int, int], speed: float) -> tuple[int, int]:
        if self._pet_position is None:
            return anchor
        blend = min(0.65, max(0.08, 0.18 * speed))
        x = int(self._pet_position[0] * (1.0 - blend) + anchor[0] * blend)
        y = int(self._pet_position[1] * (1.0 - blend) + anchor[1] * blend)
        return (x, y)

    def _resolve_anchor(self, tracking: TrackingSnapshot, expression: PetExpression) -> tuple[int, int] | None:
        anchor_name = expression.movement.target_anchor
        anchor_point = {
            "right_shoulder": tracking.right_shoulder,
            "left_shoulder": tracking.left_shoulder,
            "active_palm": tracking.active_palm,
            "nose": tracking.nose,
        }.get(anchor_name)
        if anchor_point is None:
            anchor_point = self._fallback_anchor(tracking, expression.state)
        if anchor_point is None:
            return None
        return (
            anchor_point[0] + expression.movement.offset_x,
            anchor_point[1] + expression.movement.offset_y,
        )

    @staticmethod
    def _fallback_anchor(tracking: TrackingSnapshot, state: str) -> tuple[int, int] | None:
        if state == "following" and tracking.active_palm is not None:
            return (tracking.active_palm[0], tracking.active_palm[1] - 70)
        if state in {"curious", "evolved"} and tracking.nose is not None:
            y_offset = -150 if state == "evolved" else -60
            return (tracking.nose[0] + (0 if state == "evolved" else 90), tracking.nose[1] + y_offset)
        if tracking.right_shoulder is not None:
            return (tracking.right_shoulder[0] + 110, tracking.right_shoulder[1] - 30)
        if tracking.left_shoulder is not None:
            return (tracking.left_shoulder[0] - 110, tracking.left_shoulder[1] - 30)
        return None

    def _draw_pet(self, canvas: np.ndarray, center: tuple[int, int], expression: PetExpression) -> None:
        t = time.monotonic() - self._start_time
        bob = int(math.sin(t * 2.5) * (6 + expression.energy * 10))
        center = (center[0], center[1] + bob)
        sprite = self._sheet.frame(expression, t)
        scale = 0.82 + expression.energy * 0.18 + expression.bond_level * 0.015
        if expression.state == "evolved":
            scale += 0.08
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
        cv2.putText(canvas, f"BRAIN: {expression.response_source.upper()}", (32, 102), cv2.FONT_HERSHEY_SIMPLEX, 0.5, (200, 238, 255), 1, cv2.LINE_AA)

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

    def _draw_debug(self, canvas: np.ndarray, tracking: TrackingSnapshot) -> None:
        points = [
            tracking.nose,
            tracking.left_shoulder,
            tracking.right_shoulder,
            tracking.left_wrist,
            tracking.right_wrist,
            tracking.active_palm,
        ]
        for point in points:
            if point is not None:
                cv2.circle(canvas, point, 5, (0, 255, 255), thickness=-1, lineType=cv2.LINE_AA)
        y = 126
        cv2.putText(canvas, f"confidence: {tracking.tracking_confidence:.2f}", (28, y), cv2.FONT_HERSHEY_SIMPLEX, 0.5, (255, 255, 255), 1, cv2.LINE_AA)
        for key, value in tracking.debug.items():
            y += 22
            cv2.putText(canvas, f"{key}: {value}", (28, y), cv2.FONT_HERSHEY_SIMPLEX, 0.48, (210, 230, 255), 1, cv2.LINE_AA)
