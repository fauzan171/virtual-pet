"""Speech-to-text interfaces with local mock fallback."""

from __future__ import annotations

import io
import wave
from dataclasses import dataclass

import numpy as np

from src.audio.listener import AudioCapture


@dataclass(frozen=True, slots=True)
class TranscriptionResult:
    text: str
    confidence: float = 1.0
    provider: str = "mock"


class SpeechToText:
    def transcribe(self, capture: AudioCapture) -> TranscriptionResult:
        raise NotImplementedError


class MockSpeechToText(SpeechToText):
    """Transcribes explicit scripted text without guessing from audio bytes.

    Microphone WAV data can contain byte sequences that happen to be valid
    UTF-8.  Treating those bytes as a prompt can make the pet plan nonsense
    commands when Whisper is unavailable, so raw captures deliberately produce
    an empty, low-confidence transcript.
    """

    def transcribe(self, capture: AudioCapture) -> TranscriptionResult:
        if capture.prompt_text:
            return TranscriptionResult(text=capture.prompt_text, confidence=1.0, provider="mock-scripted")
        return TranscriptionResult(text="", confidence=0.0, provider="mock-unsupported-audio")


class WhisperSpeechToText(SpeechToText):
    """Local Whisper transcription via faster-whisper."""

    def __init__(self, model_name: str = "base", language: str = "id", device: str = "cpu", compute_type: str = "int8") -> None:
        from faster_whisper import WhisperModel

        self.model = WhisperModel(model_name, device=device, compute_type=compute_type)
        self.language = language

    def transcribe(self, capture: AudioCapture) -> TranscriptionResult:
        audio = self._decode(capture)
        if audio is None or audio.size == 0:
            return TranscriptionResult(text="", confidence=0.0, provider="whisper")
        segments, _info = self.model.transcribe(
            audio,
            language=self.language,
            vad_filter=True,
        )
        text = " ".join(segment.text.strip() for segment in segments).strip()
        return TranscriptionResult(text=text, confidence=0.9, provider="whisper")

    @staticmethod
    def _decode(capture: AudioCapture) -> np.ndarray | None:
        try:
            with wave.open(io.BytesIO(capture.audio_bytes)) as wav_file:
                frames = wav_file.readframes(wav_file.getnframes())
                audio = np.frombuffer(frames, dtype=np.int16).astype(np.float32) / 32768.0
                channels = wav_file.getnchannels()
                if channels > 1:
                    audio = audio.reshape(-1, channels).mean(axis=1)
                return audio
        except (wave.Error, EOFError, ValueError):
            return None
