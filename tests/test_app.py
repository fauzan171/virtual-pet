"""Camera-loop orchestration tests without opening a camera."""

from __future__ import annotations

import unittest

from types import SimpleNamespace

from src.app.main import _preserve_gesture_ownership, _select_active_expression
from src.core.models import MovementCommand, PetExpression


class ExpressionSelectionTests(unittest.TestCase):
    @staticmethod
    def _expression(anchor: str, subtitle: str, *, state: str = "following") -> PetExpression:
        return PetExpression(
            state=state,
            subtitle=subtitle,
            color=(120, 220, 255),
            movement=MovementCommand(target_anchor=anchor),
        )

    def test_new_gesture_interrupts_cached_dialogue_motion(self) -> None:
        gesture = self._expression("left_shoulder", "Gesture baru")
        cached_dialogue = self._expression("right_shoulder", "Dialog lama")

        active, cached = _select_active_expression(
            gesture,
            cached_dialogue,
            dialogue_until=12.0,
            now=10.0,
            interrupt_dialogue=True,
        )

        self.assertIs(active, gesture)
        self.assertIsNone(cached)

    def test_dialogue_remains_active_without_new_gesture(self) -> None:
        camera = self._expression("active_palm", "Camera")
        dialogue = self._expression("right_shoulder", "Dialog")

        active, cached = _select_active_expression(
            camera,
            dialogue,
            dialogue_until=12.0,
            now=10.0,
            interrupt_dialogue=False,
        )

        self.assertIs(active, dialogue)
        self.assertIs(cached, dialogue)

    def test_same_frame_dialogue_keeps_text_but_gesture_owns_motion(self) -> None:
        gesture = self._expression("left_shoulder", "Gesture baru", state="spawning")
        gesture.animation = "dash"
        gesture.emote = "alert"
        gesture.mood = "excited"
        dialogue = self._expression("right_shoulder", "Jawaban baru", state="hidden")
        dialogue.animation = "perch"
        machine = SimpleNamespace(
            state="hidden",
            mood="calm",
            last_event_name="dialogue",
            active_movement=dialogue.movement,
            last_expression=dialogue,
        )

        merged = _preserve_gesture_ownership(
            machine,
            dialogue,
            gesture,
            event_name="wave",
        )
        active, cached = _select_active_expression(
            gesture,
            merged,
            dialogue_until=12.0,
            now=10.0,
            interrupt_dialogue=False,
        )

        self.assertEqual(active.subtitle, "Jawaban baru")
        self.assertEqual(active.state, "spawning")
        self.assertEqual(active.movement.target_anchor, "left_shoulder")
        self.assertEqual(active.animation, "dash")
        self.assertEqual(active.emote, "alert")
        self.assertIs(cached, active)
        self.assertEqual(machine.state, "spawning")
        self.assertEqual(machine.mood, "excited")
        self.assertEqual(machine.last_event_name, "wave")
        self.assertIs(machine.last_expression, active)


if __name__ == "__main__":
    unittest.main()
