"""Text-to-speech interfaces with a macOS `say` fallback."""

from __future__ import annotations

import shutil
import subprocess
from dataclasses import dataclass, field


class TextToSpeech:
    def speak(self, text: str | None) -> bool:
        raise NotImplementedError


class NullTextToSpeech(TextToSpeech):
    def speak(self, text: str | None) -> bool:
        return False


class MacOSSayTextToSpeech(TextToSpeech):
    def __init__(self, enabled: bool = False, voice: str = "Samantha") -> None:
        self.enabled = enabled and shutil.which("say") is not None
        self.voice = voice
        self._process: subprocess.Popen[str] | None = None

    def speak(self, text: str | None) -> bool:
        if not self.enabled or not text:
            return False
        if self._process and self._process.poll() is None:
            self._process.terminate()
        self._process = subprocess.Popen(
            ["say", "-v", self.voice, text],
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            text=True,
        )
        return True


@dataclass(slots=True)
class RecordingTextToSpeech(TextToSpeech):
    spoken: list[str] = field(default_factory=list)

    def speak(self, text: str | None) -> bool:
        if not text:
            return False
        self.spoken.append(text)
        return True
