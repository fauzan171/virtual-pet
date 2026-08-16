"""Tests for stable, whole-body pose geometry."""

from __future__ import annotations

import unittest
from dataclasses import FrozenInstanceError

import numpy as np

from src.cv.body_geometry import (
    BodyGeometryMapper,
    LandmarkObservation,
)


def _body_observations(**overrides: LandmarkObservation) -> dict[str, LandmarkObservation]:
    observations = {
        "nose": LandmarkObservation(0.50, 0.18, 0.95),
        "left_shoulder": LandmarkObservation(0.38, 0.32, 0.95),
        "right_shoulder": LandmarkObservation(0.62, 0.32, 0.95),
        "left_hip": LandmarkObservation(0.43, 0.55, 0.95),
        "right_hip": LandmarkObservation(0.57, 0.55, 0.95),
        "left_ankle": LandmarkObservation(0.44, 0.86, 0.90),
        "right_ankle": LandmarkObservation(0.56, 0.86, 0.90),
        "left_foot": LandmarkObservation(0.42, 0.90, 0.90),
        "right_foot": LandmarkObservation(0.58, 0.90, 0.90),
    }
    observations.update(overrides)
    return observations


class BodyGeometryMapperTests(unittest.TestCase):
    def test_models_are_frozen_and_landmarks_scale_with_resolution(self) -> None:
        observation = LandmarkObservation(0.25, 0.50)
        with self.assertRaises(FrozenInstanceError):
            observation.x = 0.5  # type: ignore[misc]

        small = BodyGeometryMapper().update(
            {"nose": observation},
            (640, 480),
            now=0.0,
        )
        large = BodyGeometryMapper().update(
            {"nose": observation},
            (1280, 960),
            now=0.0,
        )
        self.assertEqual(small.anchors["nose"], (160, 240))
        self.assertEqual(large.anchors["nose"], (320, 480))

    def test_pose_smoothing_is_invariant_to_frame_rate(self) -> None:
        def position_after_one_second(fps: int) -> int:
            mapper = BodyGeometryMapper(pose_alpha=0.30, hold_seconds=2.0)
            mapper.update(
                {"nose": LandmarkObservation(0.10, 0.50)},
                (1000, 500),
                now=0.0,
            )
            for frame in range(1, fps + 1):
                result = mapper.update(
                    {"nose": LandmarkObservation(0.90, 0.50)},
                    (1000, 500),
                    now=frame / fps,
                )
            return result.anchors["nose"][0]

        self.assertAlmostEqual(position_after_one_second(30), position_after_one_second(60), delta=1)

    def test_visibility_rejection_and_coordinate_clamping(self) -> None:
        result = BodyGeometryMapper(visibility_threshold=0.6).update(
            {
                "nose": LandmarkObservation(-0.3, 1.4, 0.95),
                "left_wrist": LandmarkObservation(0.4, 0.4, 0.59),
                "not_a_canonical_anchor": LandmarkObservation(0.5, 0.5, 1.0),
            },
            (320, 200),
            now=0.0,
        )
        self.assertEqual(result.anchors["nose"], (0, 199))
        self.assertNotIn("left_wrist", result.anchors)
        self.assertNotIn("not_a_canonical_anchor", result.anchors)

    def test_dropout_is_held_briefly_then_expires(self) -> None:
        mapper = BodyGeometryMapper(hold_seconds=0.20)
        initial = mapper.update(
            {"right_wrist": LandmarkObservation(0.75, 0.40, 0.9)},
            (400, 300),
            now=10.0,
        )
        held = mapper.update({}, (400, 300), now=10.19)
        expired = mapper.update({}, (400, 300), now=10.21)

        self.assertEqual(held.anchors["right_wrist"], initial.anchors["right_wrist"])
        self.assertEqual(held.anchor_confidence["right_wrist"], 0.9)
        self.assertNotIn("right_wrist", expired.anchors)

    def test_mask_uses_largest_component_without_a_hip_hint(self) -> None:
        mask = np.zeros((100, 120), dtype=np.float32)
        mask[5:12, 5:12] = 1.0
        mask[20:80, 30:90] = 1.0

        result = BodyGeometryMapper().update(
            {},
            (120, 100),
            now=0.0,
            segmentation_mask=mask,
        )
        self.assertEqual(result.body_bounds, (30, 20, 89, 79))
        self.assertEqual(result.bounds_source, "segmentation")

    def test_mask_prefers_component_containing_hip_midpoint(self) -> None:
        mask = np.zeros((100, 120), dtype=np.uint8)
        mask[5:80, 5:45] = 1  # Largest, but not the tracked person.
        mask[40:90, 65:105] = 1
        result = BodyGeometryMapper(pose_alpha=1.0).update(
            {
                "left_hip": LandmarkObservation(0.68, 0.60),
                "right_hip": LandmarkObservation(0.72, 0.60),
            },
            (120, 100),
            now=0.0,
            segmentation_mask=mask,
        )
        self.assertEqual(result.body_bounds, (65, 40, 104, 89))

    def test_tiny_mask_component_is_rejected_as_noise(self) -> None:
        mask = np.zeros((100, 100), dtype=np.float32)
        mask[40:45, 40:45] = 1.0

        result = BodyGeometryMapper(min_mask_area_ratio=0.015).update(
            {},
            (100, 100),
            now=0.0,
            segmentation_mask=mask,
        )
        self.assertIsNone(result.body_bounds)
        self.assertEqual(result.bounds_source, "none")

    def test_feet_extend_landmark_bounds_and_control_full_body_flag(self) -> None:
        mapper = BodyGeometryMapper(pose_alpha=1.0)
        result = mapper.update(_body_observations(), (1000, 1000), now=0.0)

        self.assertEqual(result.bounds_source, "landmarks")
        self.assertGreaterEqual(result.body_bounds[3], result.anchors["left_foot"][1])  # type: ignore[index]
        self.assertTrue(result.full_body_visible)
        self.assertIn("head_top", result.anchors)
        self.assertIn("chest", result.anchors)
        self.assertIn("hip_center", result.anchors)
        self.assertIn("body_center", result.anchors)
        self.assertAlmostEqual(result.body_scale_px, 240.0, delta=1.0)

        cropped = BodyGeometryMapper(pose_alpha=1.0).update(
            _body_observations(
                left_foot=LandmarkObservation(0.42, 1.2, 0.90),
                right_foot=LandmarkObservation(0.58, 1.2, 0.90),
            ),
            (1000, 1000),
            now=0.0,
        )
        self.assertEqual(cropped.anchors["left_foot"][1], 999)
        self.assertEqual(cropped.body_bounds[3], 999)  # type: ignore[index]
        self.assertFalse(cropped.full_body_visible)

        mask = np.zeros((1000, 1000), dtype=np.float32)
        mask[100:850, 250:750] = 1.0
        cropped_with_mask = BodyGeometryMapper(pose_alpha=1.0).update(
            _body_observations(
                left_foot=LandmarkObservation(0.42, 1.2, 0.90),
                right_foot=LandmarkObservation(0.58, 1.2, 0.90),
            ),
            (1000, 1000),
            now=0.0,
            segmentation_mask=mask,
        )
        self.assertEqual(cropped_with_mask.body_bounds[3], 999)  # type: ignore[index]
        self.assertFalse(cropped_with_mask.full_body_visible)

    def test_feet_alone_are_not_misreported_as_a_full_body(self) -> None:
        result = BodyGeometryMapper(pose_alpha=1.0).update(
            {
                "left_foot": LandmarkObservation(0.4, 0.8, 0.95),
                "right_foot": LandmarkObservation(0.6, 0.8, 0.95),
            },
            (1000, 1000),
            now=0.0,
        )

        self.assertFalse(result.full_body_visible)

    def test_visible_ankles_with_missing_feet_are_not_full_body(self) -> None:
        result = BodyGeometryMapper(pose_alpha=1.0).update(
            _body_observations(
                left_foot=LandmarkObservation(0.42, 1.2, 0.1),
                right_foot=LandmarkObservation(0.58, 1.2, 0.1),
            ),
            (1000, 1000),
            now=0.0,
        )

        self.assertIn("left_ankle", result.anchors)
        self.assertNotIn("left_foot", result.anchors)
        self.assertFalse(result.full_body_visible)

    def test_cropped_crown_is_not_hidden_by_an_interior_segmentation_mask(self) -> None:
        mask = np.zeros((100, 100), dtype=np.float32)
        mask[5:95, 20:80] = 1.0
        result = BodyGeometryMapper(pose_alpha=1.0).update(
            _body_observations(nose=LandmarkObservation(0.50, 0.02, 0.95)),
            (100, 100),
            now=0.0,
            segmentation_mask=mask,
        )

        self.assertEqual(result.anchors["head_top"][1], 0)
        self.assertEqual(result.body_bounds[1], 0)  # type: ignore[index]
        self.assertFalse(result.full_body_visible)

    def test_segmentation_unions_detached_pose_associated_components(self) -> None:
        mask = np.zeros((100, 100), dtype=np.float32)
        mask[20:70, 35:65] = 1.0  # torso / primary hip component
        mask[5:15, 40:60] = 1.0  # detached head
        mask[80:90, 20:30] = 1.0  # detached left foot
        mask[80:90, 70:80] = 1.0  # detached right foot
        observations = _body_observations(
            nose=LandmarkObservation(0.50, 0.14, 0.95),
            left_shoulder=LandmarkObservation(0.40, 0.24, 0.95),
            right_shoulder=LandmarkObservation(0.60, 0.24, 0.95),
            left_hip=LandmarkObservation(0.44, 0.58, 0.95),
            right_hip=LandmarkObservation(0.56, 0.58, 0.95),
            left_ankle=LandmarkObservation(0.25, 0.84, 0.90),
            right_ankle=LandmarkObservation(0.75, 0.84, 0.90),
            left_foot=LandmarkObservation(0.25, 0.85, 0.90),
            right_foot=LandmarkObservation(0.75, 0.85, 0.90),
        )

        result = BodyGeometryMapper(pose_alpha=1.0).update(
            observations,
            (100, 100),
            now=0.0,
            segmentation_mask=mask,
        )

        self.assertEqual(result.body_bounds, (20, 5, 79, 89))
        self.assertTrue(result.full_body_visible)


if __name__ == "__main__":
    unittest.main()
