"""Microphone capture abstractions for local-first dialogue input."""

from __future__ import annotations

import select
import sys
from collections import deque
from dataclasses import dataclass


@dataclass(slots=True)
class AudioCapture:
    audio_bytes: bytes
    sample_rate_hz: int = 16_000
    channels: int = 1
    mode: str = "push_to_talk"
    prompt_text: str | None = None


class MicrophoneListener:
    """Interface for future microphone capture backends."""

    def capture_utterance(self, timeout_s: float = 3.0) -> AudioCapture | None:
        raise NotImplementedError


class NullMicrophoneListener(MicrophoneListener):
    def capture_utterance(self, timeout_s: float = 3.0) -> AudioCapture | None:
        return None


class MockMicrophoneListener(MicrophoneListener):
    """Queue-based self-test listener that avoids device dependencies."""

    def __init__(self, captures: list[AudioCapture] | None = None) -> None:
        self._captures = deque(captures or [])

    def push(self, capture: AudioCapture) -> None:
        self._captures.append(capture)

    def capture_utterance(self, timeout_s: float = 3.0) -> AudioCapture | None:
        if not self._captures:
            return None
        return self._captures.popleft()


class StdinMicrophoneListener(MicrophoneListener):
    """CLI-friendly listener that polls stdin for typed dialogue lines."""

    def __init__(self, *, mode: str = "push_to_talk") -> None:
        self.mode = mode

    def capture_utterance(self, timeout_s: float = 0.0) -> AudioCapture | None:
        readable, _, _ = select.select([sys.stdin], [], [], timeout_s)
        if not readable:
            return None
        line = sys.stdin.readline()
        if not line:
            return None
        text = line.strip()
        if not text:
            return None
        return AudioCapture(audio_bytes=text.encode("utf-8"), prompt_text=text, mode=self.mode)
