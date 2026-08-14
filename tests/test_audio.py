"""Tests for audio-ready abstractions."""

from __future__ import annotations

import io
import unittest
import wave
from importlib.util import find_spec
from unittest import mock

from src.audio.listener import AudioCapture, MockMicrophoneListener, NullMicrophoneListener, SoundDeviceMicrophoneListener, StdinMicrophoneListener
from src.audio.stt import MockSpeechToText, WhisperSpeechToText
from src.audio.tts import NullTextToSpeech, RecordingTextToSpeech


def make_wav_bytes(samples: bytes, sample_rate_hz: int = 16_000, channels: int = 1) -> bytes:
    buffer = io.BytesIO()
    with wave.open(buffer, "wb") as wav_file:
        wav_file.setnchannels(channels)
        wav_file.setsampwidth(2)
        wav_file.setframerate(sample_rate_hz)
        wav_file.writeframes(samples)
    return buffer.getvalue()


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


class WhisperDecodeTests(unittest.TestCase):
    def test_decode_mono_wav_returns_float_audio(self) -> None:
        import numpy as np

        samples = np.zeros(160, dtype=np.int16)
        samples[::2] = 1000
        capture = AudioCapture(audio_bytes=make_wav_bytes(samples.tobytes()))

        audio = WhisperSpeechToText._decode(capture)

        self.assertIsNotNone(audio)
        self.assertEqual(audio.shape, (160,))
        self.assertAlmostEqual(float(audio[0]), 1000 / 32768, places=5)

    def test_decode_stereo_wav_mixes_to_mono(self) -> None:
        import numpy as np

        stereo = np.stack([np.full(80, 2000, dtype=np.int16), np.zeros(80, dtype=np.int16)], axis=1).ravel()
        capture = AudioCapture(audio_bytes=make_wav_bytes(stereo.tobytes(), channels=2))

        audio = WhisperSpeechToText._decode(capture)

        self.assertIsNotNone(audio)
        self.assertEqual(audio.shape, (80,))
        self.assertAlmostEqual(float(audio[0]), 1000 / 32768, places=5)

    def test_decode_invalid_bytes_returns_none(self) -> None:
        capture = AudioCapture(audio_bytes=b"not a wav")

        self.assertIsNone(WhisperSpeechToText._decode(capture))

    def test_decode_empty_wav_returns_empty_array(self) -> None:
        capture = AudioCapture(audio_bytes=make_wav_bytes(b""))

        audio = WhisperSpeechToText._decode(capture)

        self.assertIsNotNone(audio)
        self.assertEqual(audio.size, 0)


@unittest.skipUnless(find_spec("sounddevice") is not None, "sounddevice is not installed")
class SoundDeviceListenerTests(unittest.TestCase):
    def test_wav_bytes_round_trip(self) -> None:
        listener = SoundDeviceMicrophoneListener()
        frames = b"\x01\x02" * 100

        wav_bytes = listener._wav_bytes(frames)

        with wave.open(io.BytesIO(wav_bytes)) as wav_file:
            self.assertEqual(wav_file.getframerate(), listener.sample_rate_hz)
            self.assertEqual(wav_file.getnchannels(), 1)
            self.assertEqual(wav_file.readframes(wav_file.getnframes()), frames)
