"""Stable whole-body geometry derived from normalized pose observations.

The mapper deliberately owns temporal smoothing and short dropout handling so
rendering code can consume one coherent set of pixel-space anchors.  Raw model
landmark indices stay in the tracker; this module only accepts the canonical
anchor vocabulary shared in :mod:`src.core.models`.
"""

from __future__ import annotations

import math
from collections.abc import Mapping
from dataclasses import dataclass

import cv2
import numpy as np

from src.core.models import POSE_ANCHOR_NAMES


Point = tuple[int, int]
Bounds = tuple[int, int, int, int]


@dataclass(frozen=True, slots=True)
class LandmarkObservation:
    """One normalized pose landmark and its model visibility score."""

    x: float
    y: float
    visibility: float = 1.0


@dataclass(frozen=True, slots=True)
class BodyGeometry:
    """Pixel-space body geometry for one frame."""

    anchors: dict[str, tuple[int, int]]
    anchor_confidence: dict[str, float]
    body_bounds: tuple[int, int, int, int] | None
    body_scale_px: float
    full_body_visible: bool
    tracking_confidence: float
    bounds_source: str


@dataclass(slots=True)
class _TrackedAnchor:
    x: float
    y: float
    confidence: float
    last_seen: float


class BodyGeometryMapper:
    """Convert normalized landmarks into stable, resolution-aware geometry.

    ``pose_alpha`` has the familiar meaning it has in the interaction config:
    it is the EMA blend for one frame at 30 fps.  The effective blend is
    adjusted using elapsed time, giving comparable motion at other frame
    rates.  Missing or low-visibility landmarks retain their last good value
    briefly to avoid a single bad inference producing a visible teleport.
    """

    _FPS_REFERENCE = 30.0
    _CORE_ANCHORS = (
        "nose",
        "left_shoulder",
        "right_shoulder",
        "left_hip",
        "right_hip",
    )
    # An ankle alone means the leg is visible through the ankle, not that the
    # camera contains the whole person.  Full-body evidence requires a heel or
    # foot-index landmark on each side.
    _LEFT_FOOT_CHAIN = ("left_heel", "left_foot")
    _RIGHT_FOOT_CHAIN = ("right_heel", "right_foot")
    # ``head_top`` is derived after the raw pose anchors are mapped.  It still
    # belongs to the tracked silhouette: including it here prevents an
    # otherwise interior segmentation mask from hiding a crown that was
    # extrapolated beyond the camera frame.
    _SILHOUETTE_ANCHORS = (*POSE_ANCHOR_NAMES, "head_top")

    def __init__(
        self,
        *,
        pose_alpha: float = 0.45,
        visibility_threshold: float = 0.5,
        hold_seconds: float = 0.20,
        bounds_padding_ratio: float = 0.05,
        mask_threshold: float = 0.5,
        min_mask_area_ratio: float = 0.015,
    ) -> None:
        if not 0.0 <= pose_alpha <= 1.0:
            raise ValueError("pose_alpha must be between 0 and 1")
        if not 0.0 <= visibility_threshold <= 1.0:
            raise ValueError("visibility_threshold must be between 0 and 1")
        if hold_seconds < 0.0 or not math.isfinite(hold_seconds):
            raise ValueError("hold_seconds must be a finite non-negative value")
        if bounds_padding_ratio < 0.0 or not math.isfinite(bounds_padding_ratio):
            raise ValueError("bounds_padding_ratio must be a finite non-negative value")
        if not math.isfinite(mask_threshold):
            raise ValueError("mask_threshold must be finite")
        if not 0.0 <= min_mask_area_ratio <= 1.0:
            raise ValueError("min_mask_area_ratio must be between 0 and 1")

        self.pose_alpha = float(pose_alpha)
        self.visibility_threshold = float(visibility_threshold)
        self.hold_seconds = float(hold_seconds)
        self.bounds_padding_ratio = float(bounds_padding_ratio)
        self.mask_threshold = float(mask_threshold)
        self.min_mask_area_ratio = float(min_mask_area_ratio)
        self._tracked: dict[str, _TrackedAnchor] = {}

    def update(
        self,
        observations: Mapping[str, LandmarkObservation],
        frame_size: tuple[int, int],
        now: float,
        segmentation_mask: np.ndarray | None = None,
    ) -> BodyGeometry:
        """Return smoothed body geometry for the current frame.

        ``frame_size`` is ``(width, height)`` and observation coordinates are
        normalized.  Values outside the model's nominal range are clamped to
        the visible frame instead of leaking invalid renderer coordinates.
        """

        width, height = frame_size
        if width <= 0 or height <= 0:
            raise ValueError("frame_size dimensions must be positive")
        if not math.isfinite(now):
            raise ValueError("now must be finite")

        accepted: set[str] = set()
        for name in POSE_ANCHOR_NAMES:
            observation = observations.get(name)
            if observation is None or not self._observation_is_valid(observation):
                continue

            confidence = min(1.0, max(0.0, float(observation.visibility)))
            if confidence < self.visibility_threshold:
                continue

            x = min(1.0, max(0.0, float(observation.x)))
            y = min(1.0, max(0.0, float(observation.y)))
            previous = self._tracked.get(name)
            if previous is not None and self._age(previous, now) <= self.hold_seconds:
                alpha = self._effective_alpha(max(0.0, now - previous.last_seen))
                x = previous.x + (x - previous.x) * alpha
                y = previous.y + (y - previous.y) * alpha

            self._tracked[name] = _TrackedAnchor(x, y, confidence, float(now))
            accepted.add(name)

        # A rejected observation is treated exactly like a missing one.  Its
        # last good location survives the configured grace interval, then the
        # entire state entry is removed so a later reacquisition starts fresh.
        for name, tracked in tuple(self._tracked.items()):
            if name not in accepted and self._age(tracked, now) > self.hold_seconds:
                del self._tracked[name]

        anchors: dict[str, Point] = {}
        confidence: dict[str, float] = {}
        for name in POSE_ANCHOR_NAMES:
            tracked = self._tracked.get(name)
            if tracked is None:
                continue
            anchors[name] = self._to_pixel(tracked.x, tracked.y, width, height)
            confidence[name] = tracked.confidence

        self._add_derived_anchors(anchors, confidence, width, height)
        tracking_confidence = self._tracking_confidence(confidence)

        body_bounds = self._segmentation_bounds(
            segmentation_mask,
            frame_size,
            anchors,
            confidence,
        )
        if body_bounds is not None:
            bounds_source = "segmentation"
        else:
            body_bounds = self._landmark_bounds(anchors, confidence, frame_size)
            bounds_source = "landmarks" if body_bounds is not None else "none"

        # A segmentation-only frame can still provide a useful center target.
        # Its zero confidence makes the uncertainty explicit to downstream
        # movement policies.
        if "body_center" not in anchors and body_bounds is not None:
            x0, y0, x1, y1 = body_bounds
            anchors["body_center"] = ((x0 + x1) // 2, (y0 + y1) // 2)
            confidence["body_center"] = tracking_confidence

        body_scale_px = self._body_scale(anchors, body_bounds)
        full_body_visible = self._full_body_visible(
            anchors,
            confidence,
            body_bounds,
            frame_size,
        )

        return BodyGeometry(
            anchors=dict(anchors),
            anchor_confidence=dict(confidence),
            body_bounds=body_bounds,
            body_scale_px=body_scale_px,
            full_body_visible=full_body_visible,
            tracking_confidence=tracking_confidence,
            bounds_source=bounds_source,
        )

    @staticmethod
    def _observation_is_valid(observation: LandmarkObservation) -> bool:
        return all(
            math.isfinite(float(value))
            for value in (observation.x, observation.y, observation.visibility)
        )

    @staticmethod
    def _age(tracked: _TrackedAnchor, now: float) -> float:
        return max(0.0, float(now) - tracked.last_seen)

    def _effective_alpha(self, elapsed: float) -> float:
        if elapsed <= 0.0 or self.pose_alpha <= 0.0:
            return 0.0
        if self.pose_alpha >= 1.0:
            return 1.0
        return 1.0 - (1.0 - self.pose_alpha) ** (elapsed * self._FPS_REFERENCE)

    @staticmethod
    def _to_pixel(x: float, y: float, width: int, height: int) -> Point:
        px = min(width - 1, max(0, int(round(x * width))))
        py = min(height - 1, max(0, int(round(y * height))))
        return px, py

    @staticmethod
    def _midpoint(left: Point, right: Point) -> Point:
        return (
            int(round((left[0] + right[0]) * 0.5)),
            int(round((left[1] + right[1]) * 0.5)),
        )

    @staticmethod
    def _clamp_point(point: tuple[float, float], width: int, height: int) -> Point:
        return (
            min(width - 1, max(0, int(round(point[0])))),
            min(height - 1, max(0, int(round(point[1])))),
        )

    def _add_derived_anchors(
        self,
        anchors: dict[str, Point],
        confidence: dict[str, float],
        width: int,
        height: int,
    ) -> None:
        left_shoulder = anchors.get("left_shoulder")
        right_shoulder = anchors.get("right_shoulder")
        if left_shoulder is not None and right_shoulder is not None:
            anchors["chest"] = self._midpoint(left_shoulder, right_shoulder)
            confidence["chest"] = min(
                confidence["left_shoulder"],
                confidence["right_shoulder"],
            )

        left_hip = anchors.get("left_hip")
        right_hip = anchors.get("right_hip")
        if left_hip is not None and right_hip is not None:
            anchors["hip_center"] = self._midpoint(left_hip, right_hip)
            confidence["hip_center"] = min(
                confidence["left_hip"],
                confidence["right_hip"],
            )

        chest = anchors.get("chest")
        hip_center = anchors.get("hip_center")
        if chest is not None and hip_center is not None:
            anchors["body_center"] = self._midpoint(chest, hip_center)
            confidence["body_center"] = min(
                confidence["chest"],
                confidence["hip_center"],
            )

        nose = anchors.get("nose")
        if nose is not None and chest is not None:
            # Continue the nose-to-chest axis upward to estimate the crown.
            anchors["head_top"] = self._clamp_point(
                (
                    nose[0] + (nose[0] - chest[0]) * 0.55,
                    nose[1] + (nose[1] - chest[1]) * 0.55,
                ),
                width,
                height,
            )
            confidence["head_top"] = min(confidence["nose"], confidence["chest"])
        elif nose is not None:
            left_ear = anchors.get("left_ear")
            right_ear = anchors.get("right_ear")
            if left_ear is not None and right_ear is not None:
                ear_center = self._midpoint(left_ear, right_ear)
                ear_width = math.dist(left_ear, right_ear)
                anchors["head_top"] = self._clamp_point(
                    (ear_center[0], min(nose[1], ear_center[1]) - ear_width * 0.55),
                    width,
                    height,
                )
                confidence["head_top"] = min(
                    confidence["nose"],
                    confidence["left_ear"],
                    confidence["right_ear"],
                )

    def _tracking_confidence(self, confidence: Mapping[str, float]) -> float:
        score = sum(confidence.get(name, 0.0) for name in self._CORE_ANCHORS)
        return min(1.0, max(0.0, score / len(self._CORE_ANCHORS)))

    def _segmentation_bounds(
        self,
        segmentation_mask: np.ndarray | None,
        frame_size: tuple[int, int],
        anchors: Mapping[str, Point],
        confidence: Mapping[str, float],
    ) -> Bounds | None:
        if segmentation_mask is None:
            return None

        mask = np.asarray(segmentation_mask)
        if mask.ndim == 3 and mask.shape[-1] == 1:
            mask = mask[..., 0]
        elif mask.ndim == 3:
            mask = np.max(mask, axis=-1)
        if mask.ndim != 2 or mask.size == 0:
            return None

        binary = np.asarray(np.isfinite(mask) & (mask > self.mask_threshold), dtype=np.uint8)
        component_count, labels, stats, _ = cv2.connectedComponentsWithStats(
            binary,
            connectivity=8,
        )
        if component_count <= 1:
            return None

        selected_label = 0
        mask_height, mask_width = binary.shape
        frame_width, frame_height = frame_size
        hip_midpoint = anchors.get("hip_center")
        if hip_midpoint is not None:
            hip_x = min(
                mask_width - 1,
                max(0, int(hip_midpoint[0] * mask_width / frame_width)),
            )
            hip_y = min(
                mask_height - 1,
                max(0, int(hip_midpoint[1] * mask_height / frame_height)),
            )
            selected_label = int(labels[hip_y, hip_x])

        if selected_label == 0:
            foreground_areas = stats[1:, cv2.CC_STAT_AREA]
            selected_label = int(np.argmax(foreground_areas)) + 1

        selected_area = int(stats[selected_label, cv2.CC_STAT_AREA])
        if selected_area / binary.size < self.min_mask_area_ratio:
            return None

        # A single person mask can split at wrists, feet, hair, or loose
        # clothing.  Keep the primary hip/largest component, then union any
        # additional component containing a reliable pose anchor from the same
        # tracked person.  Tiny anchor-adjacent speckles are ignored.
        selected_labels = {selected_label}
        associated_min_area = max(4, int(binary.size * 0.0001))
        for name in self._SILHOUETTE_ANCHORS:
            point = anchors.get(name)
            if point is None or confidence.get(name, 0.0) < self.visibility_threshold:
                continue
            anchor_x = min(mask_width - 1, max(0, int(point[0] * mask_width / frame_width)))
            anchor_y = min(mask_height - 1, max(0, int(point[1] * mask_height / frame_height)))
            label = int(labels[anchor_y, anchor_x])
            if label > 0 and int(stats[label, cv2.CC_STAT_AREA]) >= associated_min_area:
                selected_labels.add(label)

        left = min(int(stats[label, cv2.CC_STAT_LEFT]) for label in selected_labels)
        top = min(int(stats[label, cv2.CC_STAT_TOP]) for label in selected_labels)
        right = max(
            int(stats[label, cv2.CC_STAT_LEFT] + stats[label, cv2.CC_STAT_WIDTH])
            for label in selected_labels
        )
        bottom = max(
            int(stats[label, cv2.CC_STAT_TOP] + stats[label, cv2.CC_STAT_HEIGHT])
            for label in selected_labels
        )

        # Treat each mask sample as a cell when projecting a lower-resolution
        # mask onto the video.  Identical resolutions retain exact pixel bounds.
        x0 = int(math.floor(left * frame_width / mask_width))
        y0 = int(math.floor(top * frame_height / mask_height))
        x1 = int(math.ceil(right * frame_width / mask_width)) - 1
        y1 = int(math.ceil(bottom * frame_height / mask_height)) - 1

        # Even when thresholding drops a thin limb entirely, reliable skeleton
        # points must remain inside the advertised visible-person bounds.
        reliable_points = [
            anchors[name]
            for name in self._SILHOUETTE_ANCHORS
            if name in anchors and confidence.get(name, 0.0) >= self.visibility_threshold
        ]
        if reliable_points:
            x0 = min(x0, *(point[0] for point in reliable_points))
            y0 = min(y0, *(point[1] for point in reliable_points))
            x1 = max(x1, *(point[0] for point in reliable_points))
            y1 = max(y1, *(point[1] for point in reliable_points))
        return (
            min(frame_width - 1, max(0, x0)),
            min(frame_height - 1, max(0, y0)),
            min(frame_width - 1, max(0, x1)),
            min(frame_height - 1, max(0, y1)),
        )

    def _landmark_bounds(
        self,
        anchors: Mapping[str, Point],
        confidence: Mapping[str, float],
        frame_size: tuple[int, int],
    ) -> Bounds | None:
        points = [
            point
            for name, point in anchors.items()
            if confidence.get(name, 0.0) > 0.0
        ]
        if not points:
            return None

        width, height = frame_size
        min_x = min(point[0] for point in points)
        max_x = max(point[0] for point in points)
        min_y = min(point[1] for point in points)
        max_y = max(point[1] for point in points)
        pad_x = max(1, int(round(max(1, max_x - min_x) * self.bounds_padding_ratio)))
        pad_y = max(1, int(round(max(1, max_y - min_y) * self.bounds_padding_ratio)))
        return (
            max(0, min_x - pad_x),
            max(0, min_y - pad_y),
            min(width - 1, max_x + pad_x),
            min(height - 1, max_y + pad_y),
        )

    @staticmethod
    def _body_scale(anchors: Mapping[str, Point], body_bounds: Bounds | None) -> float:
        left_shoulder = anchors.get("left_shoulder")
        right_shoulder = anchors.get("right_shoulder")
        if left_shoulder is not None and right_shoulder is not None:
            shoulder_width = math.dist(left_shoulder, right_shoulder)
            if shoulder_width > 0.0:
                return float(shoulder_width)

        left_hip = anchors.get("left_hip")
        right_hip = anchors.get("right_hip")
        if left_hip is not None and right_hip is not None:
            hip_width = math.dist(left_hip, right_hip)
            if hip_width > 0.0:
                return float(hip_width)

        if body_bounds is not None:
            x0, y0, x1, y1 = body_bounds
            bounds_width = float(x1 - x0 + 1)
            bounds_height = float(y1 - y0 + 1)
            # Height caps masks containing outstretched arms while preserving
            # the actual silhouette width for a conventional standing pose.
            return max(0.0, min(bounds_width, bounds_height * 0.35))
        return 0.0

    def _full_body_visible(
        self,
        anchors: Mapping[str, Point],
        confidence: Mapping[str, float],
        body_bounds: Bounds | None,
        frame_size: tuple[int, int],
    ) -> bool:
        if body_bounds is None:
            return False

        if confidence.get("nose", 0.0) < self.visibility_threshold:
            return False
        if confidence.get("chest", 0.0) < self.visibility_threshold:
            return False
        if confidence.get("hip_center", 0.0) < self.visibility_threshold:
            return False

        width, height = frame_size

        # Nose visibility alone cannot prove that the complete head is in
        # frame.  The derived crown must itself be reliable and strictly
        # inside the viewport; a clamped crown at an edge means the camera has
        # cropped part of the head.
        head_top = anchors.get("head_top")
        if (
            head_top is None
            or confidence.get("head_top", 0.0) < self.visibility_threshold
            or not (0 < head_top[0] < width - 1)
            or not (0 < head_top[1] < height - 1)
        ):
            return False

        def chain_is_visible(names: tuple[str, ...]) -> bool:
            return any(
                confidence.get(name, 0.0) >= self.visibility_threshold
                and name in anchors
                and 0 < anchors[name][0] < width - 1
                and 0 < anchors[name][1] < height - 1
                for name in names
            )

        if not chain_is_visible(self._LEFT_FOOT_CHAIN) or not chain_is_visible(self._RIGHT_FOOT_CHAIN):
            return False

        x0, y0, x1, y1 = body_bounds
        return x0 > 0 and y0 > 0 and x1 < width - 1 and y1 < height - 1
