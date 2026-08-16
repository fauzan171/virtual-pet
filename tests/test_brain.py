"""Tests for the local pet brain."""

from __future__ import annotations

import unittest
from unittest import mock

from src.agent.remote_planner import RemotePlanner, RemotePlannerConfig
from src.brain.local_brain import LocalPetBrain
from src.brain.openai_brain import OpenAIPetBrain
from src.brain.remote_bridge import RemoteBridgeBrain
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

    def test_local_point_gestures_choose_distinct_sides(self) -> None:
        left = self.brain.generate(
            context=self.context,
            event=InteractionEvent("point_left"),
            suggested_state="following",
            is_idle_tick=False,
        )
        right = self.brain.generate(
            context=self.context,
            event=InteractionEvent("point_right"),
            suggested_state="following",
            is_idle_tick=False,
        )

        self.assertEqual(left.movement.target_anchor, "left_shoulder")
        self.assertEqual(right.movement.target_anchor, "right_shoulder")


class RemoteBrainSafetyTests(unittest.TestCase):
    def setUp(self) -> None:
        self.context = PetContext(
            state="happy",
            mood="joyful",
            bond=4,
            energy=0.8,
            interaction_count=5,
            last_event="smile",
        )

    def test_remote_bridge_from_env_preserves_complete_planner_config(self) -> None:
        source_planner = RemotePlanner(
            RemotePlannerConfig(
                model="showcase-model",
                api_key="secret",
                api_base="https://example.invalid/v1",
                persona="tiny test fox",
                timeout_s=2.75,
                api_key_env="SHOWCASE_API_KEY",
            )
        )

        with mock.patch.object(RemotePlanner, "from_env", return_value=source_planner):
            brain = RemoteBridgeBrain.from_env()

        self.assertIsNotNone(brain)
        config = brain.coordinator.planner.config
        self.assertEqual(config.timeout_s, 2.75)
        self.assertEqual(config.api_key_env, "SHOWCASE_API_KEY")
        self.assertEqual(config.model, "showcase-model")
        self.assertEqual(config.persona, "tiny test fox")

    def test_openai_camera_generate_makes_zero_network_calls(self) -> None:
        brain = OpenAIPetBrain(
            model="fake-model",
            api_key="secret",
            api_base="https://example.invalid/v1",
        )

        with (
            mock.patch.object(
                brain.coordinator.planner,
                "plan",
                side_effect=AssertionError("camera path called the remote planner"),
            ) as remote_plan,
            mock.patch(
                "urllib.request.urlopen",
                side_effect=AssertionError("camera path opened the network"),
            ) as urlopen,
            mock.patch(
                "subprocess.run",
                side_effect=AssertionError("camera path invoked curl"),
            ) as subprocess_run,
        ):
            response = brain.generate(
                context=self.context,
                event=InteractionEvent("smile"),
                suggested_state="happy",
                is_idle_tick=False,
            )

        remote_plan.assert_not_called()
        urlopen.assert_not_called()
        subprocess_run.assert_not_called()
        self.assertEqual(brain.provider_name, "openai-compatible")
        self.assertEqual(response.response_source, "local")
        self.assertIn("smile", response.subtitle.lower())

    def test_openai_dialog_loop_owns_remote_planner(self) -> None:
        brain = OpenAIPetBrain(
            model="fake-model",
            api_key="secret",
            api_base="https://example.invalid/v1/",
            timeout_s=1.25,
        )

        loop = brain.build_dialog_loop()

        self.assertIs(loop.coordinator, brain.coordinator)
        self.assertIsInstance(loop.coordinator.planner, RemotePlanner)
        self.assertEqual(loop.coordinator.planner.config.api_base, "https://example.invalid/v1")
        self.assertEqual(loop.coordinator.planner.config.timeout_s, 1.25)
        self.assertEqual(loop.coordinator.planner.config.api_key_env, "OPENAI_API_KEY")


if __name__ == "__main__":
    unittest.main()
