"""Basic tests for the HoloPet state machine."""

from __future__ import annotations

import unittest

from src.brain.local_brain import LocalPetBrain
from src.core.models import InteractionEvent
from src.core.state_machine import HoloPetStateMachine


class StateMachineTests(unittest.TestCase):
    def setUp(self) -> None:
        self.machine = HoloPetStateMachine(
            {
                "greeting_ms": 0,
                "follow_ms": 0,
                "voice_line_ms": 0,
                "evolve_ms": 0,
                "idle_chatter_ms": 0,
            }
        )

    def test_wave_summons_pet(self) -> None:
        expression = self.machine.process(InteractionEvent("wave"), now=1.0)
        self.assertEqual(expression.state, "spawning")
        self.assertEqual(expression.mood, "excited")

    def test_evolve_requires_bond(self) -> None:
        expression = self.machine.process(InteractionEvent("two_hand_pose"), now=1.0)
        self.assertEqual(expression.state, "happy")
        self.machine.process(InteractionEvent("wave"), now=2.0)
        self.machine.process(InteractionEvent("open_palm"), now=3.0)
        self.machine.process(InteractionEvent("smile"), now=4.0)
        evolved = self.machine.process(InteractionEvent("two_hand_pose"), now=5.0)
        self.assertEqual(evolved.state, "evolved")
        self.assertGreaterEqual(evolved.energy, 0.5)

    def test_idle_tick_can_generate_chatter(self) -> None:
        machine = HoloPetStateMachine(
            {
                "greeting_ms": 0,
                "follow_ms": 0,
                "voice_line_ms": 0,
                "evolve_ms": 0,
                "idle_chatter_ms": 0,
            },
            brain=LocalPetBrain(),
        )
        machine.process(InteractionEvent("wave"), now=1.0)
        idle = machine.process(None, now=10.0)
        self.assertEqual(idle.state, "spawning")
        self.assertIsNotNone(idle.voice_line)


if __name__ == "__main__":
    unittest.main()
