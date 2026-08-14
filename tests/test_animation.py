"""Tests for the animation state-to-style mapping."""

from __future__ import annotations

import unittest

from src.render.cartoon_sheet import ANIMATIONS, AnimationStyle, resolve_animation


class AnimationStyleTests(unittest.TestCase):
    def test_resolve_unknown_animation_falls_back_to_hover(self) -> None:
        self.assertIs(resolve_animation("not_a_real_animation"), ANIMATIONS["hover"])

    def test_known_animations_resolve_to_their_style(self) -> None:
        self.assertIs(resolve_animation("dash"), ANIMATIONS["dash"])
        self.assertIs(resolve_animation("jump_to_shoulder"), ANIMATIONS["jump_to_shoulder"])

    def test_table_covers_all_planner_animation_names(self) -> None:
        known = {
            "hover", "drift", "dash", "happy_spin", "supernova", "spawn_burst",
            "peek", "perch", "orbit", "blink", "jump_to_shoulder", "bounce", "charge",
        }
        self.assertTrue(known <= set(ANIMATIONS), known - set(ANIMATIONS))

    def test_fast_animations_have_lively_tails_and_hops(self) -> None:
        for name in ("dash", "happy_spin", "jump_to_shoulder", "bounce"):
            style = ANIMATIONS[name]
            self.assertGreater(style.tail_speed, ANIMATIONS["hover"].tail_speed, name)
            self.assertGreater(style.tail_amp, ANIMATIONS["hover"].tail_amp, name)
        self.assertTrue(ANIMATIONS["dash"].leg_hop)
        self.assertFalse(ANIMATIONS["hover"].leg_hop)

    def test_calm_animations_stay_gentle(self) -> None:
        for name in ("peek", "drift"):
            style = ANIMATIONS[name]
            self.assertLess(style.tail_speed, ANIMATIONS["hover"].tail_speed, name)

    def test_arm_wave_only_where_expected(self) -> None:
        waving = {name for name, style in ANIMATIONS.items() if style.arm_wave}
        self.assertEqual(waving, {"perch", "charge"})

    def test_default_style_is_frozen(self) -> None:
        style = AnimationStyle()
        with self.assertRaises(Exception):
            style.tail_speed = 9.0  # type: ignore[misc]


if __name__ == "__main__":
    unittest.main()
