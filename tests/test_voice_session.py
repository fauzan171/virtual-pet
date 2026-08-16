"""Deterministic lifecycle and concurrency tests for half-duplex voice."""

from __future__ import annotations

import threading
import time
import unittest
from unittest import mock

from src.audio.listener import AudioCapture, MicrophoneListener, MockMicrophoneListener
from src.audio.session import VoiceSession, VoiceState
from src.audio.stt import MockSpeechToText, SpeechToText, TranscriptionResult
from src.audio.tts import RecordingTextToSpeech, TextToSpeech


def wait_until(predicate, timeout_s: float = 1.0) -> bool:
    deadline = time.monotonic() + timeout_s
    while time.monotonic() < deadline:
        if predicate():
            return True
        time.sleep(0.005)
    return bool(predicate())


class CountingListener(MockMicrophoneListener):
    def __init__(self, captures=None) -> None:
        super().__init__(captures)
        self.capture_calls = 0

    def capture_utterance(self, timeout_s=3.0, cancel_event=None):
        self.capture_calls += 1
        return super().capture_utterance(timeout_s=timeout_s, cancel_event=cancel_event)


class BlockingTextToSpeech(TextToSpeech):
    def __init__(self) -> None:
        self.started = threading.Event()
        self.released = threading.Event()
        self.spoken: list[str] = []
        self.cancel_calls = 0

    def speak(self, text: str | None) -> bool:
        if not text:
            return False
        self.spoken.append(text)
        self.started.set()
        return True

    def wait(self, timeout_s: float | None = None) -> bool:
        return self.released.wait(timeout_s)

    def cancel(self) -> None:
        self.cancel_calls += 1
        self.released.set()


class SequenceSpeechToText(SpeechToText):
    def __init__(self) -> None:
        self.calls = 0

    def transcribe(self, capture: AudioCapture) -> TranscriptionResult:
        self.calls += 1
        if self.calls == 1:
            raise RuntimeError("temporary STT failure")
        return TranscriptionResult("halo lagi", confidence=0.9, provider="test")


class DelayedUserListener(MicrophoneListener):
    """Holds one real utterance so camera speech can queue while listening."""

    def __init__(self) -> None:
        self.started = threading.Event()
        self.release_user = threading.Event()
        self._cancelled = threading.Event()
        self._used = False

    def capture_utterance(self, timeout_s=3.0, cancel_event=None):
        if self._used:
            if cancel_event is not None:
                cancel_event.wait(timeout_s)
            else:
                time.sleep(timeout_s)
            return None
        self.started.set()
        self.release_user.wait(timeout=1.0)
        if self._cancelled.is_set() or (cancel_event is not None and cancel_event.is_set()):
            return None
        self._used = True
        return AudioCapture(audio_bytes=b"", prompt_text="halo pet")

    def cancel(self) -> None:
        self._cancelled.set()
        self.release_user.set()

    def reset(self) -> None:
        self._cancelled.clear()


class VoiceSessionTests(unittest.TestCase):
    @staticmethod
    def _scripted_listener(*utterances: str) -> MockMicrophoneListener:
        return MockMicrophoneListener(
            [AudioCapture(audio_bytes=b"", prompt_text=text) for text in utterances]
        )

    def test_success_states_and_result_arrive_before_tts_finishes(self) -> None:
        tts = BlockingTextToSpeech()
        states = []
        result_seen = threading.Event()
        session = VoiceSession(
            listener=self._scripted_listener("halo"),
            stt=MockSpeechToText(),
            planner=lambda text: f"jawab:{text}",
            tts=tts,
            result_sink=lambda _result: result_seen.set(),
            speech_text=lambda result: result,
            status_sink=lambda status: states.append(status.state),
            post_speech_guard_ms=0,
        )
        worker = threading.Thread(target=session.run_turn)

        worker.start()
        self.assertTrue(result_seen.wait(1.0))
        self.assertTrue(tts.started.is_set())
        self.assertTrue(worker.is_alive())
        self.assertEqual(session.state, VoiceState.SPEAKING)
        tts.released.set()
        worker.join(1.0)

        self.assertFalse(worker.is_alive())
        expected = [
            VoiceState.LISTENING,
            VoiceState.TRANSCRIBING,
            VoiceState.THINKING,
            VoiceState.SPEAKING,
            VoiceState.IDLE,
        ]
        self.assertEqual(states, expected)

    def test_empty_or_low_confidence_transcript_skips_planner_and_tts(self) -> None:
        class LowConfidenceSTT(SpeechToText):
            def transcribe(self, capture):
                return TranscriptionResult("noise", confidence=0.1, provider="test")

        planner = mock.Mock()
        tts = RecordingTextToSpeech()
        session = VoiceSession(
            listener=self._scripted_listener("ignored"),
            stt=LowConfidenceSTT(),
            planner=planner,
            tts=tts,
            speech_text=lambda result: str(result),
            min_transcript_confidence=0.5,
        )

        self.assertIsNone(session.run_turn())
        planner.assert_not_called()
        self.assertEqual(tts.spoken, [])

    def test_one_turn_error_does_not_break_the_next_turn(self) -> None:
        states = []
        tts = RecordingTextToSpeech()
        session = VoiceSession(
            listener=self._scripted_listener("first", "second"),
            stt=SequenceSpeechToText(),
            planner=lambda text: f"jawab:{text}",
            tts=tts,
            speech_text=lambda result: result,
            status_sink=lambda status: states.append(status.state),
            failure_backoff_s=0,
            post_speech_guard_ms=0,
        )

        first = session.run_turn()
        second = session.run_turn()

        self.assertIsNone(first)
        self.assertEqual(second, "jawab:halo lagi")
        self.assertIn(VoiceState.ERROR, states)
        self.assertEqual(tts.spoken, ["jawab:halo lagi"])

    def test_transient_listener_reset_error_stays_inside_worker_recovery(self) -> None:
        class FlakyResetListener(MockMicrophoneListener):
            def __init__(self) -> None:
                super().__init__([AudioCapture(audio_bytes=b"", prompt_text="halo")])
                self.reset_calls = 0

            def reset(self) -> None:
                self.reset_calls += 1
                if self.reset_calls == 1:
                    raise RuntimeError("temporary reset failure")
                super().reset()

        listener = FlakyResetListener()
        states = []
        results = []
        session = VoiceSession(
            listener=listener,
            stt=MockSpeechToText(),
            planner=lambda text: f"jawab:{text}",
            tts=RecordingTextToSpeech(),
            result_sink=results.append,
            status_sink=lambda status: states.append(status.state),
            failure_backoff_s=0,
            post_speech_guard_ms=0,
        )

        session.start()
        self.assertTrue(wait_until(lambda: results == ["jawab:halo"]))
        self.assertTrue(session.running)
        session.stop()
        session.join(1.0)

        self.assertGreaterEqual(listener.reset_calls, 2)
        self.assertIn(VoiceState.ERROR, states)

    def test_broken_tts_cancel_cannot_kill_error_recovery(self) -> None:
        class FlakyCancelTTS(TextToSpeech):
            def __init__(self) -> None:
                self.speak_calls = 0
                self.spoken = []

            def speak(self, text):
                self.speak_calls += 1
                if self.speak_calls == 1:
                    raise RuntimeError("speaker failed")
                self.spoken.append(text)
                return True

            def cancel(self):
                raise RuntimeError("cancel failed")

        tts = FlakyCancelTTS()
        session = VoiceSession(
            listener=self._scripted_listener("first", "second"),
            stt=MockSpeechToText(),
            planner=lambda text: f"jawab:{text}",
            tts=tts,
            speech_text=lambda result: result,
            failure_backoff_s=0,
            post_speech_guard_ms=0,
        )

        self.assertEqual(session.run_turn(), "jawab:first")
        self.assertEqual(session.state, VoiceState.IDLE)
        self.assertEqual(session.run_turn(), "jawab:second")
        self.assertEqual(tts.spoken, ["jawab:second"])

    def test_microphone_does_not_reopen_while_tts_is_speaking(self) -> None:
        listener = CountingListener([AudioCapture(audio_bytes=b"", prompt_text="halo")])
        tts = BlockingTextToSpeech()
        session = VoiceSession(
            listener=listener,
            stt=MockSpeechToText(),
            planner=lambda text: text,
            tts=tts,
            speech_text=lambda result: result,
            capture_timeout_s=0.05,
            post_speech_guard_ms=0,
        )

        session.start()
        self.assertTrue(tts.started.wait(1.0))
        time.sleep(0.08)
        self.assertEqual(listener.capture_calls, 1)
        tts.released.set()
        self.assertTrue(wait_until(lambda: listener.capture_calls >= 2))
        session.stop()
        session.join(1.0)

    def test_stop_cancels_tts_and_joins_worker(self) -> None:
        tts = BlockingTextToSpeech()
        session = VoiceSession(
            listener=self._scripted_listener("halo"),
            stt=MockSpeechToText(),
            planner=lambda text: text,
            tts=tts,
            speech_text=lambda result: result,
            post_speech_guard_ms=0,
        )

        session.start()
        self.assertTrue(tts.started.wait(1.0))
        session.stop()
        session.join(1.0)

        self.assertFalse(session.running)
        self.assertGreaterEqual(tts.cancel_calls, 1)

    def test_stop_while_thinking_never_publishes_a_stale_result(self) -> None:
        planning = threading.Event()
        release_planner = threading.Event()
        published = []
        tts = RecordingTextToSpeech()

        def slow_planner(text: str) -> str:
            planning.set()
            release_planner.wait(1.0)
            return f"stale:{text}"

        session = VoiceSession(
            listener=self._scripted_listener("halo"),
            stt=MockSpeechToText(),
            planner=slow_planner,
            tts=tts,
            result_sink=published.append,
            speech_text=lambda result: result,
            post_speech_guard_ms=0,
        )

        session.start()
        self.assertTrue(planning.wait(1.0))
        session.stop()
        session.join(0.05)
        release_planner.set()
        session.join(1.0)

        self.assertEqual(published, [])
        self.assertEqual(tts.spoken, [])

    def test_per_frame_duplicate_camera_lines_are_coalesced(self) -> None:
        listener = CountingListener()
        tts = RecordingTextToSpeech()
        session = VoiceSession(
            listener=listener,
            stt=MockSpeechToText(),
            planner=lambda text: text,
            tts=tts,
            speech_text=lambda result: result,
            capture_timeout_s=0.05,
            post_speech_guard_ms=0,
        )

        session.start()
        self.assertTrue(wait_until(lambda: session.state == VoiceState.LISTENING))
        accepted = [session.request_speech("kamera halo") for _ in range(10)]
        self.assertEqual(sum(accepted), 1)
        self.assertTrue(wait_until(lambda: tts.spoken == ["kamera halo"]))
        time.sleep(0.08)
        session.stop()
        session.join(1.0)

        self.assertEqual(tts.spoken, ["kamera halo"])

    def test_fresh_gesture_can_interrupt_mismatched_dialogue_audio(self) -> None:
        tts = BlockingTextToSpeech()
        session = VoiceSession(
            listener=self._scripted_listener("halo"),
            stt=MockSpeechToText(),
            planner=lambda text: f"dialog:{text}",
            tts=tts,
            speech_text=lambda result: result,
            capture_timeout_s=0.05,
            post_speech_guard_ms=0,
        )

        session.start()
        self.assertTrue(tts.started.wait(1.0))
        self.assertEqual(session.state, VoiceState.SPEAKING)
        self.assertTrue(session.request_speech("gesture baru", interrupt=True))
        self.assertTrue(wait_until(lambda: tts.spoken == ["dialog:halo", "gesture baru"]))
        session.stop()
        session.join(1.0)

        self.assertGreaterEqual(tts.cancel_calls, 1)

    def test_cancel_only_interrupt_stops_dialogue_when_gesture_has_no_line(self) -> None:
        tts = BlockingTextToSpeech()
        session = VoiceSession(
            listener=self._scripted_listener("halo"),
            stt=MockSpeechToText(),
            planner=lambda text: f"dialog:{text}",
            tts=tts,
            speech_text=lambda result: result,
            capture_timeout_s=0.05,
            post_speech_guard_ms=0,
        )

        session.start()
        self.assertTrue(tts.started.wait(1.0))
        self.assertTrue(session.interrupt_speech())
        self.assertTrue(wait_until(lambda: tts.cancel_calls >= 1))
        session.stop()
        session.join(1.0)

    def test_cancelled_audio_keeps_mic_closed_during_acoustic_guard(self) -> None:
        listener = CountingListener([AudioCapture(audio_bytes=b"", prompt_text="halo")])
        tts = BlockingTextToSpeech()
        session = VoiceSession(
            listener=listener,
            stt=MockSpeechToText(),
            planner=lambda text: f"dialog:{text}",
            tts=tts,
            speech_text=lambda result: result,
            capture_timeout_s=0.05,
            post_speech_guard_ms=140,
        )

        session.start()
        self.assertTrue(tts.started.wait(1.0))
        self.assertTrue(session.interrupt_speech())
        self.assertTrue(wait_until(lambda: tts.cancel_calls >= 1))
        time.sleep(0.06)
        self.assertEqual(listener.capture_calls, 1)
        self.assertTrue(wait_until(lambda: listener.capture_calls >= 2, timeout_s=0.4))
        session.stop()
        session.join(1.0)

    def test_interrupt_flag_is_published_before_worker_can_take_replacement(self) -> None:
        class GatedEvent:
            def __init__(self) -> None:
                self.entered = threading.Event()
                self.release = threading.Event()
                self.value = threading.Event()

            def set(self) -> None:
                self.entered.set()
                self.release.wait(1.0)
                self.value.set()

            def clear(self) -> None:
                self.value.clear()

            def is_set(self) -> bool:
                return self.value.is_set()

        session = VoiceSession(
            listener=CountingListener(),
            stt=MockSpeechToText(),
            planner=lambda text: text,
            tts=RecordingTextToSpeech(),
        )
        gate = GatedEvent()
        session._interrupt_speech_event = gate  # type: ignore[assignment]
        session._running_event.set()
        session._set_status(VoiceState.SPEAKING)
        request_done = threading.Event()
        take_done = threading.Event()

        def request() -> None:
            session.request_speech("gesture", interrupt=True)
            request_done.set()

        taken = []

        def take() -> None:
            taken.append(session._take_speech_request())
            take_done.set()

        request_thread = threading.Thread(target=request)
        request_thread.start()
        self.assertTrue(gate.entered.wait(1.0))
        take_thread = threading.Thread(target=take)
        take_thread.start()
        time.sleep(0.03)
        self.assertFalse(take_done.is_set())

        gate.release.set()
        request_thread.join(1.0)
        take_thread.join(1.0)

        self.assertTrue(request_done.is_set())
        self.assertTrue(take_done.is_set())
        self.assertEqual(taken[0].text, "gesture")

    def test_real_user_utterance_drops_pending_camera_chatter(self) -> None:
        listener = DelayedUserListener()
        tts = RecordingTextToSpeech()
        results = []
        session = VoiceSession(
            listener=listener,
            stt=MockSpeechToText(),
            planner=lambda text: f"jawab:{text}",
            tts=tts,
            result_sink=results.append,
            speech_text=lambda result: result,
            capture_timeout_s=0.5,
            post_speech_guard_ms=0,
        )

        session.start()
        self.assertTrue(listener.started.wait(1.0))
        self.assertTrue(session.request_speech("gesture line"))
        listener.release_user.set()
        self.assertTrue(wait_until(lambda: results == ["jawab:halo pet"]))
        session.stop()
        session.join(1.0)

        self.assertNotIn("gesture line", tts.spoken)
        self.assertIn("jawab:halo pet", tts.spoken)

    def test_immediate_request_after_start_never_blocks_caller(self) -> None:
        tts = BlockingTextToSpeech()
        session = VoiceSession(
            listener=CountingListener(),
            stt=MockSpeechToText(),
            planner=lambda text: text,
            tts=tts,
            capture_timeout_s=0.2,
            post_speech_guard_ms=0,
        )

        session.start()
        started_at = time.monotonic()
        accepted = session.request_speech("cepat")
        elapsed = time.monotonic() - started_at

        self.assertTrue(accepted)
        self.assertLess(elapsed, 0.05)
        session.stop()
        session.join(1.0)


if __name__ == "__main__":
    unittest.main()
