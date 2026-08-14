"""Tests for Hermes-style agent scaffolding."""

from __future__ import annotations

import tempfile
import unittest
from pathlib import Path
from unittest import mock

from src.agent.coordinator import AgentCoordinator
from src.agent.dialog_loop import DialogueLoop
from src.agent.persistence import JsonAgentPersistence
from src.agent.remote_planner import RemotePlanner, RemotePlannerConfig
from src.audio.tts import RecordingTextToSpeech
from src.brain.hermes_bridge import HermesBridgeBrain
from src.brain.remote_bridge import RemoteBridgeBrain
from src.core.models import InteractionEvent, PetContext, TrackingSnapshot


class AgentTests(unittest.TestCase):
    def test_memory_updates_from_name_introduction(self) -> None:
        coordinator = AgentCoordinator()
        context = PetContext(
            state="happy",
            mood="joyful",
            bond=3,
            energy=0.7,
            interaction_count=4,
            last_event="smile",
            memory_summary="empty",
        )
        plan = coordinator.handle(context=context, event=None, user_utterance="Namaku Jadi")
        self.assertIn("Jadi", plan.reply)
        self.assertEqual(coordinator.session.memory.user_name, "Jadi")

    def test_hermes_bridge_generates_response(self) -> None:
        brain = HermesBridgeBrain()
        context = PetContext(
            state="following",
            mood="playful",
            bond=2,
            energy=0.5,
            interaction_count=2,
            last_event="open_palm",
            memory_summary="empty",
        )
        response = brain.generate(
            context=context,
            event=InteractionEvent("open_palm"),
            suggested_state="following",
            is_idle_tick=False,
        )
        self.assertEqual(response.animation, "perch")
        self.assertEqual(response.movement.target_anchor, "active_palm")

    def test_dialog_loop_uses_persistent_memory(self) -> None:
        with tempfile.TemporaryDirectory() as tmpdir:
            memory_path = Path(tmpdir) / "memory.json"
            brain = HermesBridgeBrain(memory_path=memory_path)
            tts = RecordingTextToSpeech()
            loop = brain.build_dialog_loop(tts=tts)
            context = PetContext(
                state="happy",
                mood="joyful",
                bond=3,
                energy=0.7,
                interaction_count=4,
                last_event="smile",
            )

            first = loop.handle_text(context=context, utterance="Namaku Jadi")
            second = loop.handle_text(context=context, utterance="namaku siapa")

            self.assertIn("Jadi", first.plan.reply)
            self.assertIn("Jadi", second.plan.reply)
            self.assertEqual(tts.spoken[-1], second.plan.reply)
            self.assertTrue(memory_path.exists())

    def test_dialog_loop_mentions_tracking_when_wobbly(self) -> None:
        coordinator = AgentCoordinator()
        loop = DialogueLoop(coordinator=coordinator, tts=RecordingTextToSpeech())
        context = PetContext(
            state="following",
            mood="playful",
            bond=2,
            energy=0.5,
            interaction_count=2,
            last_event="open_palm",
        )
        tracking = TrackingSnapshot(frame_size=(1280, 720), tracking_confidence=0.2)

        result = loop.handle_text(context=context, utterance="ke bahu kanan", tracking=tracking)

        self.assertIn("wobbly", result.plan.reply)

    def test_json_persistence_round_trip(self) -> None:
        with tempfile.TemporaryDirectory() as tmpdir:
            path = Path(tmpdir) / "pet.json"
            persistence = JsonAgentPersistence(path)
            coordinator = AgentCoordinator(persistence=persistence)
            context = PetContext(
                state="happy",
                mood="joyful",
                bond=3,
                energy=0.7,
                interaction_count=4,
                last_event="smile",
            )

            coordinator.handle(context=context, event=None, user_utterance="Namaku Jadi")
            reloaded = JsonAgentPersistence(path).load_session()

            self.assertEqual(reloaded.memory.user_name, "Jadi")
            self.assertGreater(reloaded.turn_count, 0)

    def test_remote_planner_parses_action_plan(self) -> None:
        payload = {
            "choices": [
                {
                    "message": {
                        "content": (
                            '{"reply":"Halo Jadi, aku geser ke bahu kanan.","emotion":"playful",'
                            '"animation":"jump_to_shoulder","emote":"soft","color_rgb":[120,220,255],'
                            '"movement":{"target_anchor":"right_shoulder","offset_x":90,"offset_y":-40,"speed":1.2},'
                            '"memory_update":{"user_name":"Jadi","notes":["Met Jadi"]},"should_speak":true,'
                            '"suggested_state":"following"}'
                        )
                    }
                }
            ]
        }

        planner = RemotePlanner(
            RemotePlannerConfig(
                model="fake-model",
                api_key="secret",
                api_base="https://example.invalid/v1",
            )
        )
        context = PetContext(
            state="happy",
            mood="joyful",
            bond=3,
            energy=0.7,
            interaction_count=4,
            last_event="smile",
        )
        fake_completed = mock.Mock()
        fake_completed.stdout = __import__("json").dumps(payload)
        with mock.patch("subprocess.run", return_value=fake_completed):
            plan = planner.plan(context=context, event=None, user_utterance="ke bahu kanan")

        self.assertEqual(plan.movement.target_anchor, "right_shoulder")
        self.assertEqual(plan.memory_update.user_name, "Jadi")
        self.assertEqual(plan.response_source, "remote")

    def test_remote_bridge_dialog_loop_uses_remote_memory(self) -> None:
        with tempfile.TemporaryDirectory() as tmpdir:
            memory_path = Path(tmpdir) / "remote.json"
            brain = RemoteBridgeBrain(
                model="fake-model",
                api_key="secret",
                api_base="https://example.invalid/v1",
                memory_path=memory_path,
            )
            fake_plan = brain.coordinator.planner.fallback.plan
            with mock.patch.object(brain.coordinator.planner, "plan", side_effect=fake_plan):
                result = brain.build_dialog_loop(tts=RecordingTextToSpeech()).handle_text(
                    context=PetContext(
                        state="happy",
                        mood="joyful",
                        bond=3,
                        energy=0.7,
                        interaction_count=4,
                        last_event="smile",
                    ),
                    utterance="Namaku Jadi",
                )

        self.assertIn("Jadi", result.plan.reply)


if __name__ == "__main__":
    unittest.main()
