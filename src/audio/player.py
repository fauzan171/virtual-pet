"""Compatibility adapter for the newer TTS abstraction."""

from __future__ import annotations

from src.audio.tts import MacOSSayTextToSpeech


class VoicePlayer:
    """Maintains the original `speak()` API for the webcam demo."""

    def __init__(self, enabled: bool = False) -> None:
        self.engine = MacOSSayTextToSpeech(enabled=enabled)

    def speak(self, text: str | None) -> None:
        self.engine.speak(text)
