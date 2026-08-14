"""Procedural cartoon sprite sheet for the HoloPet character."""

from __future__ import annotations

import math
from dataclasses import dataclass
from pathlib import Path

import cv2
import numpy as np

from src.core.models import PetExpression


def _rgba_canvas(size: int) -> np.ndarray:
    return np.zeros((size, size, 4), dtype=np.uint8)


@dataclass(slots=True)
class SkinStyle:
    """Palette and feature switches for one pet character look."""

    ear_shape: str = "point"  # point | round
    tail: bool = True
    blush: bool = True
    paw_color: tuple[int, int, int] = (234, 244, 255)


SKINS: dict[str, SkinStyle] = {
    "fox": SkinStyle(),
    "cat": SkinStyle(ear_shape="round", tail=False, paw_color=(246, 235, 255)),
    "bunny": SkinStyle(ear_shape="tall", tail=False, blush=True, paw_color=(255, 240, 246)),
}


def list_skins() -> list[str]:
    return sorted(SKINS)


def _draw_glow(canvas: np.ndarray, center: tuple[int, int], radius: int, color: tuple[int, int, int], alpha: int) -> None:
    overlay = canvas.copy()
    cv2.circle(overlay, center, radius, (*color, alpha), thickness=-1, lineType=cv2.LINE_AA)
    mask = overlay[:, :, 3:4] / 255.0
    canvas[:, :, :3] = (overlay[:, :, :3] * mask + canvas[:, :, :3] * (1 - mask)).astype(np.uint8)
    canvas[:, :, 3] = np.maximum(canvas[:, :, 3], overlay[:, :, 3])


def _alpha_blit(dst: np.ndarray, src: np.ndarray, top_left: tuple[int, int]) -> None:
    x0, y0 = top_left
    h, w = src.shape[:2]
    if x0 >= dst.shape[1] or y0 >= dst.shape[0] or x0 + w <= 0 or y0 + h <= 0:
        return

    sx0 = max(0, -x0)
    sy0 = max(0, -y0)
    dx0 = max(0, x0)
    dy0 = max(0, y0)
    width = min(w - sx0, dst.shape[1] - dx0)
    height = min(h - sy0, dst.shape[0] - dy0)
    if width <= 0 or height <= 0:
        return

    src_crop = src[sy0 : sy0 + height, sx0 : sx0 + width]
    dst_crop = dst[dy0 : dy0 + height, dx0 : dx0 + width]
    alpha = src_crop[:, :, 3:4].astype(np.float32) / 255.0
    dst_crop[:, :, :3] = (src_crop[:, :, :3] * alpha + dst_crop[:, :, :3] * (1 - alpha)).astype(np.uint8)
    dst_crop[:, :, 3] = np.maximum(dst_crop[:, :, 3], src_crop[:, :, 3])


class CartoonPetSheet:
    """Builds a cute cartoon fox-style hologram pet as animation frames."""

    def __init__(self, frame_size: int = 192, skin: str = "fox") -> None:
        self.frame_size = frame_size
        self.skin_name = skin if skin in SKINS else "fox"
        self.style = SKINS[self.skin_name]

    def frame(self, expression: PetExpression, tick: float) -> np.ndarray:
        size = self.frame_size
        canvas = _rgba_canvas(size)
        cx = size // 2
        base_y = int(size * 0.58 + math.sin(tick * 2.8) * (6 + expression.energy * 8))

        scale = 1.0 + expression.bond_level * 0.03
        if expression.state == "evolved":
            scale += 0.15

        body_color = expression.color
        outline = (18, 28, 38)
        soft_white = (246, 251, 255)
        paw_white = self.style.paw_color
        blush = (255, 179, 210)
        has_tail = self.style.tail
        ear_shape = self.style.ear_shape

        _draw_glow(canvas, (cx, base_y + 8), int(56 * scale), body_color, 26)
        _draw_glow(canvas, (cx, base_y + 8), int(42 * scale), body_color, 42)

        body_w = int(62 * scale)
        body_h = int(54 * scale)
        head_r = int(36 * scale)
        face_r = int(24 * scale)
        tail_len = int(42 * scale)
        leg_hop = int(math.sin(tick * 7.0) * 3) if expression.animation in {"happy_spin", "dash"} else 0

        if has_tail:
            tail_swing = math.sin(tick * (6.0 if expression.animation in {"dash", "happy_spin"} else 3.2)) * (16 if expression.animation in {"dash", "happy_spin"} else 8)
            tail = np.array(
                [
                    [cx - body_w // 2 + 4, base_y + 10],
                    [cx - body_w // 2 - tail_len // 2, base_y + 18 + int(tail_swing * 0.2)],
                    [cx - body_w // 2 - tail_len, base_y + int(tail_swing * 0.45)],
                    [cx - body_w // 2 - tail_len // 2, base_y - 6 + int(tail_swing * 0.25)],
                ],
                dtype=np.int32,
            )
            cv2.polylines(canvas, [tail], False, (*body_color, 255), 12, cv2.LINE_AA)
            cv2.polylines(canvas, [tail], False, (*outline, 255), 3, cv2.LINE_AA)

        cv2.ellipse(canvas, (cx, base_y + 12), (body_w // 2, body_h // 2), 0, 0, 360, (*body_color, 255), -1, cv2.LINE_AA)
        cv2.ellipse(canvas, (cx, base_y + 12), (body_w // 2, body_h // 2), 0, 0, 360, (*outline, 255), 3, cv2.LINE_AA)
        cv2.ellipse(canvas, (cx, base_y + 20), (int(body_w * 0.28), int(body_h * 0.22)), 0, 0, 360, (*soft_white, 255), -1, cv2.LINE_AA)
        cv2.ellipse(canvas, (cx, base_y + 20), (int(body_w * 0.28), int(body_h * 0.22)), 0, 0, 360, (*outline, 255), 2, cv2.LINE_AA)

        head_y = base_y - 28
        cv2.circle(canvas, (cx, head_y), head_r, (*body_color, 255), -1, cv2.LINE_AA)
        cv2.circle(canvas, (cx, head_y), head_r, (*outline, 255), 3, cv2.LINE_AA)

        self._draw_ears(canvas, cx, head_y, head_r, body_color, outline, blush)

        cv2.ellipse(canvas, (cx, head_y + 8), (face_r, int(face_r * 0.78)), 0, 0, 360, (*soft_white, 255), -1, cv2.LINE_AA)
        cv2.ellipse(canvas, (cx, head_y + 8), (face_r, int(face_r * 0.78)), 0, 0, 360, (*outline, 255), 2, cv2.LINE_AA)

        eye_y = head_y + 2
        eye_dx = int(head_r * 0.42)
        blink = expression.animation == "blink" or abs(math.sin(tick * 1.5)) < 0.06
        if blink:
            cv2.line(canvas, (cx - eye_dx - 5, eye_y), (cx - eye_dx + 5, eye_y), (*outline, 255), 3, cv2.LINE_AA)
            cv2.line(canvas, (cx + eye_dx - 5, eye_y), (cx + eye_dx + 5, eye_y), (*outline, 255), 3, cv2.LINE_AA)
        else:
            cv2.circle(canvas, (cx - eye_dx, eye_y), 7, (*outline, 255), -1, cv2.LINE_AA)
            cv2.circle(canvas, (cx + eye_dx, eye_y), 7, (*outline, 255), -1, cv2.LINE_AA)
            cv2.circle(canvas, (cx - eye_dx + 2, eye_y - 2), 2, (*soft_white, 255), -1, cv2.LINE_AA)
            cv2.circle(canvas, (cx + eye_dx + 2, eye_y - 2), 2, (*soft_white, 255), -1, cv2.LINE_AA)

        cv2.circle(canvas, (cx, head_y + 13), 4, (*outline, 255), -1, cv2.LINE_AA)
        if expression.emote in {"grin", "star"} or expression.state in {"happy", "evolved"}:
            cv2.ellipse(canvas, (cx, head_y + 21), (12, 7), 0, 0, 180, (*outline, 255), 3, cv2.LINE_AA)
        elif expression.emote in {"curious", "focus"} or expression.state == "curious":
            cv2.circle(canvas, (cx, head_y + 23), 5, (*outline, 255), 2, cv2.LINE_AA)
        else:
            cv2.line(canvas, (cx - 8, head_y + 22), (cx + 8, head_y + 22), (*outline, 255), 3, cv2.LINE_AA)

        cv2.circle(canvas, (cx - 24, head_y + 16), 5, (*blush, 200), -1, cv2.LINE_AA)
        cv2.circle(canvas, (cx + 24, head_y + 16), 5, (*blush, 200), -1, cv2.LINE_AA)

        left_leg_y = base_y + 38 + leg_hop
        right_leg_y = base_y + 38 - leg_hop
        for px, py in ((cx - 16, left_leg_y), (cx + 16, right_leg_y)):
            cv2.line(canvas, (px, base_y + 34), (px, py), (*outline, 255), 6, cv2.LINE_AA)
            cv2.ellipse(canvas, (px, py + 4), (10, 6), 0, 0, 360, (*paw_white, 255), -1, cv2.LINE_AA)
            cv2.ellipse(canvas, (px, py + 4), (10, 6), 0, 0, 360, (*outline, 255), 2, cv2.LINE_AA)

        if expression.animation in {"perch", "dash"}:
            arm_shift = int(math.sin(tick * 9) * 4)
            cv2.line(canvas, (cx + 26, base_y + 2), (cx + 50, base_y - 12 + arm_shift), (*outline, 255), 5, cv2.LINE_AA)
            cv2.ellipse(canvas, (cx + 56, base_y - 14 + arm_shift), (9, 6), 0, 0, 360, (*paw_white, 255), -1, cv2.LINE_AA)
            cv2.ellipse(canvas, (cx + 56, base_y - 14 + arm_shift), (9, 6), 0, 0, 360, (*outline, 255), 2, cv2.LINE_AA)

        if expression.state == "evolved":
            ring_r = int(66 + math.sin(tick * 4.6) * 5)
            cv2.circle(canvas, (cx, head_y + 2), ring_r, (*body_color, 180), 2, cv2.LINE_AA)
            for idx in range(5):
                ang = tick * 2.4 + idx * (2 * math.pi / 5)
                px = int(cx + math.cos(ang) * ring_r)
                py = int(head_y + 2 + math.sin(ang) * ring_r)
                cv2.circle(canvas, (px, py), 4, (*soft_white, 240), -1, cv2.LINE_AA)

        return canvas

    def _draw_ears(
        self,
        canvas: np.ndarray,
        cx: int,
        head_y: int,
        head_r: int,
        body_color: tuple[int, int, int],
        outline: tuple[int, int, int],
        blush: tuple[int, int, int],
    ) -> None:
        ear_offset = int(head_r * 0.7)
        if self.style.ear_shape == "round":
            for sign in (-1, 1):
                center = (cx + sign * ear_offset, head_y - head_r + 2)
                cv2.circle(canvas, center, int(head_r * 0.42), (*body_color, 255), -1, cv2.LINE_AA)
                cv2.circle(canvas, center, int(head_r * 0.42), (*outline, 255), 3, cv2.LINE_AA)
            return
        if self.style.ear_shape == "tall":
            for sign in (-1, 1):
                center = (cx + sign * int(head_r * 0.5), head_y - int(head_r * 1.15))
                cv2.ellipse(canvas, center, (int(head_r * 0.3), int(head_r * 0.75)), sign * -12, 0, 360, (*body_color, 255), -1, cv2.LINE_AA)
                cv2.ellipse(canvas, center, (int(head_r * 0.3), int(head_r * 0.75)), sign * -12, 0, 360, (*outline, 255), 3, cv2.LINE_AA)
                cv2.ellipse(canvas, (center[0], center[1] + 4), (int(head_r * 0.16), int(head_r * 0.5)), sign * -12, 0, 360, (*blush, 230), -1, cv2.LINE_AA)
            return
        ear_top = int(head_r * 1.18)
        left_ear = np.array(
            [[cx - ear_offset + 6, head_y - head_r + 8], [cx - ear_offset - 10, head_y - ear_top], [cx - ear_offset + 22, head_y - ear_top + 12]],
            dtype=np.int32,
        )
        right_ear = np.array(
            [[cx + ear_offset - 6, head_y - head_r + 8], [cx + ear_offset + 10, head_y - ear_top], [cx + ear_offset - 22, head_y - ear_top + 12]],
            dtype=np.int32,
        )
        for ear in (left_ear, right_ear):
            cv2.fillConvexPoly(canvas, ear, (*body_color, 255), cv2.LINE_AA)
            cv2.polylines(canvas, [ear], True, (*outline, 255), 3, cv2.LINE_AA)
        inner_left = np.array([[cx - ear_offset + 4, head_y - head_r + 14], [cx - ear_offset - 5, head_y - ear_top + 18], [cx - ear_offset + 15, head_y - ear_top + 20]], dtype=np.int32)
        inner_right = np.array([[cx + ear_offset - 4, head_y - head_r + 14], [cx + ear_offset + 5, head_y - ear_top + 18], [cx + ear_offset - 15, head_y - ear_top + 20]], dtype=np.int32)
        cv2.fillConvexPoly(canvas, inner_left, (*blush, 230), cv2.LINE_AA)
        cv2.fillConvexPoly(canvas, inner_right, (*blush, 230), cv2.LINE_AA)

    def export_preview_sheet(self, output_path: str | Path) -> None:
        output_path = Path(output_path)
        output_path.parent.mkdir(parents=True, exist_ok=True)
        variants = [
            PetExpression("spawning", "Hi!", (255, 225, 120), mood="excited", animation="spawn_burst", emote="spark"),
            PetExpression("following", "Following", (120, 220, 255), mood="playful", animation="perch", emote="soft"),
            PetExpression("curious", "Curious", (255, 200, 120), mood="curious", animation="peek", emote="curious"),
            PetExpression("happy", "Happy", (120, 255, 170), mood="joyful", animation="happy_spin", emote="grin"),
            PetExpression("evolved", "Evolved", (90, 255, 220), mood="heroic", animation="supernova", emote="star", bond_level=5, energy=1.0),
        ]
        frames = [self.frame(expr, idx * 0.35) for idx, expr in enumerate(variants)]
        label_h = 34
        pad = 12
        sheet_h = self.frame_size + label_h + pad * 2
        sheet_w = len(frames) * (self.frame_size + pad) + pad
        sheet = np.full((sheet_h, sheet_w, 3), 18, dtype=np.uint8)
        for idx, (expr, frame) in enumerate(zip(variants, frames)):
            x0 = pad + idx * (self.frame_size + pad)
            y0 = pad
            rgba = frame
            rgb_bg = np.full((self.frame_size, self.frame_size, 3), (20, 26, 35), dtype=np.uint8)
            alpha = rgba[:, :, 3:4].astype(np.float32) / 255.0
            rgb = (rgba[:, :, :3] * alpha + rgb_bg * (1 - alpha)).astype(np.uint8)
            sheet[y0 : y0 + self.frame_size, x0 : x0 + self.frame_size] = rgb
            cv2.putText(sheet, expr.state.upper(), (x0 + 18, y0 + self.frame_size + 22), cv2.FONT_HERSHEY_SIMPLEX, 0.58, (220, 245, 255), 2, cv2.LINE_AA)
        cv2.imwrite(str(output_path), sheet)


def composite_sprite(canvas_bgr: np.ndarray, sprite_rgba: np.ndarray, center: tuple[int, int], scale: float = 1.0) -> None:
    if scale != 1.0:
        new_w = max(1, int(sprite_rgba.shape[1] * scale))
        new_h = max(1, int(sprite_rgba.shape[0] * scale))
        sprite_rgba = cv2.resize(sprite_rgba, (new_w, new_h), interpolation=cv2.INTER_AREA)
    x0 = int(center[0] - sprite_rgba.shape[1] / 2)
    y0 = int(center[1] - sprite_rgba.shape[0] / 2)
    canvas_rgba = cv2.cvtColor(canvas_bgr, cv2.COLOR_BGR2BGRA)
    _alpha_blit(canvas_rgba, sprite_rgba, (x0, y0))
    canvas_bgr[:, :, :] = cv2.cvtColor(canvas_rgba, cv2.COLOR_BGRA2BGR)
