"""Tests for audio-ready abstractions."""

from __future__ import annotations

import unittest
from unittest import mock

from src.audio.listener import AudioCapture, MockMicrophoneListener, NullMicrophoneListener, StdinMicrophoneListener
from src.audio.stt import MockSpeechToText
from src.audio.tts import NullTextToSpeech, RecordingTextToSpeech


class AudioAbstractionTests(unittest.TestCase):
    def test_mock_listener_returns_scripted_capture(self) -> None:
        listener = MockMicrophoneListener([AudioCapture(audio_bytes=b"", prompt_text="hello pet")])

        capture = listener.capture_utterance()

        self.assertIsNotNone(capture)
        self.assertEqual(capture.prompt_text, "hello pet")

    def test_null_listener_returns_none(self) -> None:
        self.assertIsNone(NullMicrophoneListener().capture_utterance())

    def test_mock_stt_prefers_prompt_text(self) -> None:
        stt = MockSpeechToText()

        result = stt.transcribe(AudioCapture(audio_bytes=b"ignored", prompt_text="move left"))

        self.assertEqual(result.text, "move left")

    def test_recording_tts_captures_spoken_lines(self) -> None:
        tts = RecordingTextToSpeech()

        spoken = tts.speak("tiny hello")

        self.assertTrue(spoken)
        self.assertEqual(tts.spoken, ["tiny hello"])

    def test_null_tts_is_safe_noop(self) -> None:
        self.assertFalse(NullTextToSpeech().speak("hello"))

    def test_stdin_listener_reads_available_line(self) -> None:
        listener = StdinMicrophoneListener()
        fake_stdin = mock.Mock()
        fake_stdin.readline.return_value = "move right\n"

        with mock.patch("src.audio.listener.select.select", return_value=([fake_stdin], [], [])):
            with mock.patch("src.audio.listener.sys.stdin", fake_stdin):
                capture = listener.capture_utterance()

        self.assertIsNotNone(capture)
        self.assertEqual(capture.prompt_text, "move right")
