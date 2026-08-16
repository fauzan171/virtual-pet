"""Camera-loop orchestration tests without opening a camera."""

from __future__ import annotations

import unittest
from unittest import mock

from types import SimpleNamespace

from src.app.main import (
    _VoiceInputSnapshotStore,
    _interrupt_dialogue_speech,
    _preserve_gesture_ownership,
    _select_active_expression,
    _speak_camera_line,
    _start_dialogue_session,
    _stop_voice_session,
    _voice_status_text,
    _voice_session_is_speaking,
    build_voice_input,
)
from src.audio.listener import StdinMicrophoneListener
from src.audio.stt import MockSpeechToText
from src.core.models import MovementCommand, PetContext, PetExpression, TrackingSnapshot


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

    def test_dialogue_subtitle_stays_visible_past_ttl_while_audio_speaks(self) -> None:
        camera = self._expression("active_palm", "Camera")
        dialogue = self._expression("right_shoulder", "Kalimat yang masih dibacakan")

        active, cached = _select_active_expression(
            camera,
            dialogue,
            dialogue_until=2.8,
            now=4.0,
            interrupt_dialogue=False,
            dialogue_speaking=True,
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


class VoiceAppIntegrationTests(unittest.TestCase):
    def test_whisper_failure_disables_mic_as_one_atomic_fallback(self) -> None:
        fake_mic = mock.Mock()
        with mock.patch("src.app.main.SoundDeviceMicrophoneListener", return_value=fake_mic), mock.patch(
            "src.audio.stt.WhisperSpeechToText",
            side_effect=RuntimeError("model missing"),
        ):
            listener, stt = build_voice_input("base")

        self.assertIsInstance(listener, StdinMicrophoneListener)
        self.assertIsInstance(stt, MockSpeechToText)
        self.assertIsNotNone(stt)

    def test_microphone_failure_still_returns_a_complete_typed_pair(self) -> None:
        with mock.patch(
            "src.app.main.SoundDeviceMicrophoneListener",
            side_effect=RuntimeError("no device"),
        ):
            listener, stt = build_voice_input("base")

        self.assertIsInstance(listener, StdinMicrophoneListener)
        self.assertIsInstance(stt, MockSpeechToText)

    def test_microphone_permission_failure_during_preflight_uses_typed_pair(self) -> None:
        fake_mic = mock.Mock()
        fake_mic.validate_input.side_effect = RuntimeError("permission denied")
        with mock.patch("src.app.main.SoundDeviceMicrophoneListener", return_value=fake_mic), mock.patch(
            "src.audio.stt.WhisperSpeechToText"
        ) as whisper:
            listener, stt = build_voice_input("base")

        self.assertIsInstance(listener, StdinMicrophoneListener)
        self.assertIsInstance(stt, MockSpeechToText)
        whisper.assert_not_called()

    def test_voice_input_snapshot_is_detached_from_later_machine_changes(self) -> None:
        first_context = PetContext(
            state="happy",
            mood="joyful",
            bond=2,
            energy=0.7,
            interaction_count=3,
        )
        second_context = PetContext(
            state="following",
            mood="curious",
            bond=3,
            energy=0.8,
            interaction_count=4,
        )
        machine = SimpleNamespace(_context=mock.Mock(side_effect=[first_context, second_context]))
        snapshots = _VoiceInputSnapshotStore(machine)
        tracking = TrackingSnapshot(frame_size=(640, 480), tracking_confidence=0.82)

        self.assertIs(snapshots.context(), first_context)
        snapshots.update(machine, tracking)

        self.assertIs(snapshots.context(), second_context)
        self.assertIs(snapshots.tracking(), tracking)
        machine._context.assert_called_with(tracking_confidence=0.82)

    def test_session_gets_result_sink_snapshot_suppliers_and_voice_timing(self) -> None:
        context = PetContext(
            state="happy",
            mood="joyful",
            bond=2,
            energy=0.7,
            interaction_count=3,
        )
        machine = SimpleNamespace(_context=mock.Mock(return_value=context))
        snapshots = _VoiceInputSnapshotStore(machine)
        results = __import__("queue").Queue()
        sentinel_session = object()

        class FakeLoop:
            def start_voice_session(self, **kwargs):
                self.options = kwargs
                kwargs["result_sink"]("ready-before-speech")
                return sentinel_session

        loop = FakeLoop()
        session = _start_dialogue_session(
            loop,
            snapshots,
            results,
            {
                "capture_timeout_s": 0.4,
                "min_transcript_confidence": 0.51,
                "failure_backoff_s": 0.3,
                "post_speech_guard_ms": 420,
            },
        )

        self.assertIs(session, sentinel_session)
        self.assertEqual(results.get_nowait(), "ready-before-speech")
        self.assertIs(loop.options["context_supplier"](), context)
        self.assertIsNone(loop.options["tracking_supplier"]())
        self.assertEqual(loop.options["capture_timeout_s"], 0.4)
        self.assertEqual(loop.options["min_transcript_confidence"], 0.51)
        self.assertEqual(loop.options["failure_backoff_s"], 0.3)
        self.assertEqual(loop.options["post_speech_guard_ms"], 420)

    def test_camera_voice_line_routes_through_active_session(self) -> None:
        loop = SimpleNamespace(
            voice_session=object(),
            request_speech=mock.Mock(return_value=True),
        )
        second_player = SimpleNamespace(speak=mock.Mock(side_effect=AssertionError("second TTS")))

        accepted = _speak_camera_line(loop, second_player, "Hai!")

        self.assertTrue(accepted)
        loop.request_speech.assert_called_once_with("Hai!", interrupt=True)
        second_player.speak.assert_not_called()

    def test_gesture_without_voice_line_still_interrupts_stale_dialogue_audio(self) -> None:
        loop = SimpleNamespace(
            voice_session=object(),
            interrupt_speech=mock.Mock(return_value=True),
        )

        interrupted = _interrupt_dialogue_speech(loop)

        self.assertTrue(interrupted)
        loop.interrupt_speech.assert_called_once_with()

    def test_voice_shutdown_requests_stop_and_join(self) -> None:
        session = SimpleNamespace(stop=mock.Mock(), join=mock.Mock())

        _stop_voice_session(session)

        session.stop.assert_called_once_with()
        session.join.assert_called_once_with(timeout=2.0)

    def test_voice_status_is_flattened_without_audio_type_import(self) -> None:
        state = SimpleNamespace(value="thinking")
        session = SimpleNamespace(
            state=state,
            status=SimpleNamespace(state=state, error=None),
        )

        self.assertEqual(_voice_status_text(session), "thinking")
        self.assertFalse(_voice_session_is_speaking(session))

        state.value = "speaking"
        self.assertTrue(_voice_session_is_speaking(session))


if __name__ == "__main__":
    unittest.main()
