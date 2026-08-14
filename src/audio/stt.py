"""Speech-to-text interfaces with local mock fallback."""

from __future__ import annotations

from dataclasses import dataclass

from src.audio.listener import AudioCapture


@dataclass(slots=True)
class TranscriptionResult:
    text: str
    confidence: float = 1.0
    provider: str = "mock"


class SpeechToText:
    def transcribe(self, capture: AudioCapture) -> TranscriptionResult:
        raise NotImplementedError


class MockSpeechToText(SpeechToText):
    """Prefers a scripted prompt and falls back to UTF-8 decoded bytes."""

    def transcribe(self, capture: AudioCapture) -> TranscriptionResult:
        if capture.prompt_text:
            return TranscriptionResult(text=capture.prompt_text, confidence=1.0, provider="mock-scripted")
        text = capture.audio_bytes.decode("utf-8", errors="ignore").strip() or "(silence)"
        return TranscriptionResult(text=text, confidence=0.55, provider="mock-bytes")
