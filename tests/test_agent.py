"""Tests for Hermes-style agent scaffolding."""

from __future__ import annotations

import json
import tempfile
import threading
import time
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest import mock

from src.agent.coordinator import AgentCoordinator
from src.agent.dialog_loop import DialogueLoop
from src.agent.persistence import JsonAgentPersistence
from src.agent.remote_planner import RemotePlanner, RemotePlannerConfig
from src.audio.tts import RecordingTextToSpeech
from src.brain.hermes_bridge import HermesBridgeBrain
from src.brain.remote_bridge import RemoteBridgeBrain
from src.core.models import MOVEMENT_ANCHOR_NAMES, InteractionEvent, PetContext, TrackingSnapshot


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

    def test_memory_updates_from_favorite_color(self) -> None:
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
        plan = coordinator.handle(context=context, event=None, user_utterance="warna favoritku biru")

        self.assertIn("biru", plan.reply.lower())
        self.assertEqual(coordinator.session.memory.favorite_color, "biru")

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

    def test_dialog_loop_refuses_restart_while_old_voice_worker_is_alive(self) -> None:
        loop = DialogueLoop(coordinator=AgentCoordinator())
        old_session = SimpleNamespace(
            running=True,
            stop=mock.Mock(),
            join=mock.Mock(),
        )
        loop.voice_session = old_session
        context = PetContext(
            state="happy", mood="joyful", bond=2, energy=0.6, interaction_count=3,
        )

        with self.assertRaisesRegex(RuntimeError, "still stopping"):
            loop.start_voice_session(context_supplier=lambda: context)

        old_session.stop.assert_called_once_with()
        old_session.join.assert_called_once_with(timeout=1.0)

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

        for utterance in ("ke bahu kanan", "ke siku kiri", "ke lutut kanan", "duduk di dada"):
            result = loop.handle_text(context=context, utterance=utterance, tracking=tracking)
            self.assertIn("tracking", result.plan.reply.lower(), utterance)
            self.assertTrue(result.plan.movement_requested, utterance)

    def test_fallback_dialogue_stays_short_and_pet_like(self) -> None:
        coordinator = AgentCoordinator()
        result = coordinator.handle(
            context=PetContext(
                state="happy",
                mood="joyful",
                bond=2,
                energy=0.6,
                interaction_count=3,
                last_event="smile",
            ),
            event=None,
            user_utterance="dekat",
        )

        self.assertLessEqual(len(result.reply.split(".")), 3)
        self.assertEqual(result.movement.target_anchor, "nose")

    def test_last_topic_updates_from_movement_command(self) -> None:
        coordinator = AgentCoordinator()
        context = PetContext(
            state="happy", mood="joyful", bond=2, energy=0.6, interaction_count=3, last_event="smile",
        )
        coordinator.handle(context=context, event=None, user_utterance="ke bahu kanan")
        self.assertEqual(coordinator.session.memory.last_topic, "gerak")

    def test_last_topic_recall(self) -> None:
        coordinator = AgentCoordinator()
        context = PetContext(
            state="happy", mood="joyful", bond=2, energy=0.6, interaction_count=3, last_event="smile",
        )
        coordinator.handle(context=context, event=None, user_utterance="ke bahu kanan")
        result = coordinator.handle(context=context, event=None, user_utterance="tadi kita bahas apa")
        self.assertIn("gerak", result.reply)

    def test_favorite_color_recalled_in_small_talk(self) -> None:
        coordinator = AgentCoordinator()
        context = PetContext(
            state="happy", mood="joyful", bond=2, energy=0.6, interaction_count=3, last_event="smile",
        )
        coordinator.handle(context=context, event=None, user_utterance="aku suka warna favorit biru")
        result = coordinator.handle(context=context, event=None, user_utterance="halo")
        self.assertIn("biru", result.reply)

    def test_body_anchor_utterances_route_to_whole_body(self) -> None:
        coordinator = AgentCoordinator()
        context = PetContext(
            state="happy", mood="joyful", bond=2, energy=0.6, interaction_count=3, last_event="smile",
        )
        cases = {
            "ke siku kiri dong": "left_elbow",
            "nangkring di lutut kanan": "right_knee",
            "duduk di paha kiri": "left_hip",
            "turun ke pergelangan kaki kiri": "left_ankle",
            "hinggap di telapak kaki kanan": "right_foot",
            "duduk di dada": "chest",
            "naik ke kepala": "nose",
        }
        for utterance, expected_anchor in cases.items():
            result = coordinator.handle(context=context, event=None, user_utterance=utterance)
            self.assertEqual(result.movement.target_anchor, expected_anchor, utterance)

    def test_idle_event_plan_wanders(self) -> None:
        coordinator = AgentCoordinator()
        anchors = set()
        for step in range(7):
            context = PetContext(
                state="happy", mood="joyful", bond=2, energy=0.6, interaction_count=step, last_event="smile",
            )
            plan = coordinator.handle(context=context, event=None, user_utterance=None)
            anchors.add(plan.movement.target_anchor)
        self.assertGreater(len(anchors), 3)

    def test_name_recalled_in_movement_reply(self) -> None:
        coordinator = AgentCoordinator()
        context = PetContext(
            state="happy", mood="joyful", bond=2, energy=0.6, interaction_count=3, last_event="smile",
        )
        coordinator.handle(context=context, event=None, user_utterance="Namaku Jadi")
        result = coordinator.handle(context=context, event=None, user_utterance="ke bahu kanan")
        self.assertIn("Jadi", result.reply)

    def test_last_topic_persists_across_runs(self) -> None:
        with tempfile.TemporaryDirectory() as tmpdir:
            path = Path(tmpdir) / "pet.json"
            context = PetContext(
                state="happy", mood="joyful", bond=2, energy=0.6, interaction_count=3, last_event="smile",
            )
            AgentCoordinator(persistence=JsonAgentPersistence(path)).handle(
                context=context, event=None, user_utterance="ke bahu kanan"
            )
            reloaded = JsonAgentPersistence(path).load_session()
            self.assertEqual(reloaded.memory.last_topic, "gerak")

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

    def test_json_persistence_writes_backup_after_second_save(self) -> None:
        with tempfile.TemporaryDirectory() as tmpdir:
            path = Path(tmpdir) / "pet.json"
            persistence = JsonAgentPersistence(path)
            session = persistence.load_session()
            session.memory.user_name = "Jadi"
            persistence.save_session(session)
            session.memory.favorite_color = "biru"
            persistence.save_session(session)

            self.assertTrue(persistence.backup_path.exists())

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
                            '"movement_requested":true,'
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
        with mock.patch.object(planner, "_chat_completion", return_value=payload):
            plan = planner.plan(context=context, event=None, user_utterance="ke bahu kanan")

        self.assertEqual(plan.movement.target_anchor, "right_shoulder")
        self.assertEqual(plan.memory_update.user_name, "Jadi")
        self.assertTrue(plan.movement_requested)
        self.assertEqual(plan.response_source, "remote")

    def test_remote_failure_reply_flags_local_source(self) -> None:
        planner = RemotePlanner(
            RemotePlannerConfig(model="fake-model", api_key="secret", api_base="https://example.invalid/v1")
        )
        context = PetContext(
            state="happy", mood="joyful", bond=2, energy=0.6, interaction_count=3, last_event="smile",
        )
        with mock.patch.object(planner, "_chat_completion", side_effect=ValueError("boom")):
            plan = planner.plan(context=context, event=None, user_utterance="ke bahu kanan")

        self.assertEqual(plan.response_source, "fallback")
        self.assertIn("otak lokal", plan.reply)
        self.assertEqual(plan.movement.target_anchor, "right_shoulder")

    def test_remote_body_drip_falls_back_within_total_deadline(self) -> None:
        release_read = threading.Event()
        read_started = threading.Event()
        response_closed = threading.Event()

        class DrippingResponse:
            def __enter__(self):
                return self

            def __exit__(self, exc_type, exc, traceback):
                self.close()
                return False

            def close(self) -> None:
                response_closed.set()
                release_read.set()

            def read(self) -> bytes:
                read_started.set()
                # Simulate a transport whose read keeps receiving tiny pieces
                # and therefore never reaches urllib's inactivity timeout.
                while not release_read.wait(0.005):
                    pass
                return b'{"choices": []}'

        planner = RemotePlanner(
            RemotePlannerConfig(
                model="fake-model",
                api_key="secret",
                api_base="https://example.invalid/v1",
                timeout_s=0.05,
            )
        )
        context = PetContext(
            state="happy", mood="joyful", bond=2, energy=0.6, interaction_count=3,
        )

        started_at = time.monotonic()
        try:
            with mock.patch("urllib.request.urlopen", return_value=DrippingResponse()) as urlopen:
                plan = planner.plan(context=context, event=None, user_utterance="halo")
            elapsed_s = time.monotonic() - started_at
            self.assertTrue(read_started.is_set())
            urlopen.assert_called_once()
            self.assertTrue(response_closed.wait(0.2))
        finally:
            release_read.set()

        self.assertEqual(plan.response_source, "fallback")
        self.assertLess(elapsed_s, 0.35)

    def test_remote_transport_keeps_secret_and_prompt_off_process_argv(self) -> None:
        secret_key = "test-api-key-that-must-not-enter-argv"
        secret_prompt = "memory: user's private favorite is nebula blue"
        response_body = json.dumps({"ok": True}).encode("utf-8")
        captured_request: dict[str, object] = {}

        class StaticResponse:
            def __enter__(self):
                return self

            def __exit__(self, exc_type, exc, traceback):
                return False

            def read(self) -> bytes:
                return response_body

        def fake_urlopen(request, *, timeout):
            captured_request["request"] = request
            captured_request["timeout"] = timeout
            return StaticResponse()

        planner = RemotePlanner(
            RemotePlannerConfig(
                model="fake-model",
                api_key=secret_key,
                api_base="https://example.invalid/v1",
                timeout_s=0.5,
            )
        )
        payload = {"messages": [{"role": "user", "content": secret_prompt}]}

        with (
            mock.patch("subprocess.Popen") as popen,
            mock.patch("subprocess.run") as subprocess_run,
            mock.patch("urllib.request.urlopen", side_effect=fake_urlopen),
        ):
            result = planner._chat_completion(payload)

        self.assertEqual(result, {"ok": True})
        popen.assert_not_called()
        subprocess_run.assert_not_called()
        request = captured_request["request"]
        self.assertEqual(request.get_header("Authorization"), f"Bearer {secret_key}")
        self.assertIn(secret_prompt, request.data.decode("utf-8"))

    def test_malformed_remote_response_shapes_fall_back_safely(self) -> None:
        planner = RemotePlanner(
            RemotePlannerConfig(model="fake-model", api_key="secret", api_base="https://example.invalid/v1")
        )
        context = PetContext(
            state="happy", mood="joyful", bond=2, energy=0.6, interaction_count=3, last_event="smile",
        )
        malformed_payloads = (
            {"choices": []},
            {"choices": [{"message": {"content": None}}]},
            {"choices": None},
        )

        for payload in malformed_payloads:
            with self.subTest(payload=payload), mock.patch.object(
                planner,
                "_chat_completion",
                return_value=payload,
            ):
                plan = planner.plan(context=context, event=None, user_utterance="ke bahu kanan")

            self.assertEqual(plan.response_source, "fallback")
            self.assertEqual(plan.movement.target_anchor, "right_shoulder")

    def test_remote_movement_intent_is_inferred_when_model_omits_or_denies_it(self) -> None:
        planner = RemotePlanner(
            RemotePlannerConfig(model="fake-model", api_key="secret", api_base="https://example.invalid/v1")
        )
        context = PetContext(
            state="happy", mood="joyful", bond=2, energy=0.6, interaction_count=3, last_event="smile",
        )
        for remote_value in (None, False):
            response = {
                "reply": "Sip.",
                "movement": {"target_anchor": "left_elbow"},
                "memory_update": {},
            }
            if remote_value is not None:
                response["movement_requested"] = remote_value
            payload = {
                "choices": [{"message": {"content": __import__("json").dumps(response)}}]
            }

            with self.subTest(remote_value=remote_value), mock.patch.object(
                planner,
                "_chat_completion",
                return_value=payload,
            ):
                plan = planner.plan(context=context, event=None, user_utterance="ke siku kiri")

            self.assertTrue(plan.movement_requested)
            self.assertEqual(plan.response_source, "remote")

    def test_remote_cannot_hallucinate_movement_intent_for_small_talk(self) -> None:
        planner = RemotePlanner(
            RemotePlannerConfig(model="fake-model", api_key="secret", api_base="https://example.invalid/v1")
        )
        context = PetContext(
            state="happy", mood="joyful", bond=2, energy=0.6, interaction_count=3, last_event="smile",
        )
        response = {
            "reply": "Halo juga!",
            "movement": {"target_anchor": "nose"},
            "memory_update": {},
            "movement_requested": True,
        }
        payload = {"choices": [{"message": {"content": __import__("json").dumps(response)}}]}

        with mock.patch.object(planner, "_chat_completion", return_value=payload):
            plan = planner.plan(context=context, event=None, user_utterance="halo")

        self.assertFalse(plan.movement_requested)

    def test_remote_parser_accepts_every_renderer_anchor(self) -> None:
        context = PetContext(
            state="happy", mood="joyful", bond=2, energy=0.6, interaction_count=3, last_event="smile",
        )
        for anchor in MOVEMENT_ANCHOR_NAMES:
            plan = RemotePlanner._parse_plan(
                {
                    "reply": "Sip.",
                    "color_rgb": [120, 220, 255],
                    "movement": {"target_anchor": anchor},
                },
                context,
            )
            self.assertEqual(plan.movement.target_anchor, anchor)

    def test_remote_parser_rejects_unknown_anchor(self) -> None:
        context = PetContext(
            state="happy", mood="joyful", bond=2, energy=0.6, interaction_count=3, last_event="smile",
        )
        plan = RemotePlanner._parse_plan(
            {
                "reply": "Sip.",
                "color_rgb": [120, 220, 255],
                "movement": {"target_anchor": "teleport_outside_frame"},
            },
            context,
        )
        self.assertEqual(plan.movement.target_anchor, "right_shoulder")

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
