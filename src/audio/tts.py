"""Text-to-speech interfaces with a macOS `say` fallback."""

from __future__ import annotations

import shutil
import subprocess
import threading
from dataclasses import dataclass, field


class TextToSpeech:
    def speak(self, text: str | None) -> bool:
        raise NotImplementedError

    def wait(self, timeout_s: float | None = None) -> bool:
        """Wait for playback completion.

        Synchronous and no-op implementations are complete as soon as
        ``speak`` returns.  Asynchronous backends override this method so the
        voice session can keep microphone capture closed until playback ends.
        """

        return True

    def cancel(self) -> None:
        """Stop current playback, if any."""

    @property
    def speaking(self) -> bool:
        return False


class NullTextToSpeech(TextToSpeech):
    def speak(self, text: str | None) -> bool:
        return False


class MacOSSayTextToSpeech(TextToSpeech):
    def __init__(self, enabled: bool = False, voice: str = "Samantha") -> None:
        self.enabled = enabled and shutil.which("say") is not None
        self.voice = voice
        self._process: subprocess.Popen[str] | None = None
        self._lock = threading.RLock()

    def speak(self, text: str | None) -> bool:
        if not self.enabled or not text:
            return False
        with self._lock:
            self._cancel_locked()
            self._process = subprocess.Popen(
                ["say", "-v", self.voice, text],
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
                text=True,
            )
        return True

    def wait(self, timeout_s: float | None = None) -> bool:
        with self._lock:
            process = self._process
        if process is None:
            return True
        try:
            process.wait(timeout=timeout_s)
        except subprocess.TimeoutExpired:
            return False
        return True

    def cancel(self) -> None:
        with self._lock:
            self._cancel_locked()

    @property
    def speaking(self) -> bool:
        with self._lock:
            return self._process is not None and self._process.poll() is None

    def _cancel_locked(self) -> None:
        process = self._process
        if process is None or process.poll() is not None:
            return
        process.terminate()
        try:
            process.wait(timeout=0.25)
        except subprocess.TimeoutExpired:
            process.kill()
            process.wait(timeout=0.25)


@dataclass(slots=True)
class RecordingTextToSpeech(TextToSpeech):
    spoken: list[str] = field(default_factory=list)

    def speak(self, text: str | None) -> bool:
        if not text:
            return False
        self.spoken.append(text)
        return True
