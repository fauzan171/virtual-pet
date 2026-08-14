"""Tests for the local pet brain."""

from __future__ import annotations

import unittest

from src.brain.local_brain import LocalPetBrain
from src.core.models import InteractionEvent, PetContext


class LocalBrainTests(unittest.TestCase):
    def setUp(self) -> None:
        self.brain = LocalPetBrain()
        self.context = PetContext(
            state="happy",
            mood="joyful",
            bond=4,
            energy=0.8,
            interaction_count=5,
            last_event="smile",
        )

    def test_smile_gets_positive_line(self) -> None:
        response = self.brain.generate(
            context=self.context,
            event=InteractionEvent("smile"),
            suggested_state="happy",
            is_idle_tick=False,
        )
        self.assertEqual(response.mood, "joyful")
        self.assertIn("smile", response.subtitle.lower())

    def test_idle_tick_can_speak(self) -> None:
        response = self.brain.generate(
            context=self.context,
            event=None,
            suggested_state="happy",
            is_idle_tick=True,
        )
        self.assertIsNotNone(response.voice_line)

    def test_idle_tick_wanders_across_body_anchors(self) -> None:
        anchors = set()
        for step in range(7):
            self.context.interaction_count = step
            response = self.brain.generate(
                context=self.context,
                event=None,
                suggested_state="happy",
                is_idle_tick=True,
            )
            anchors.add(response.movement.target_anchor)
        self.assertGreater(len(anchors), 3)


if __name__ == "__main__":
    unittest.main()
