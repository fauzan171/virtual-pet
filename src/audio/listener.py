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


class SoundDeviceMicrophoneListener(MicrophoneListener):
    """Real microphone listener: records speech until trailing silence, returns WAV bytes.

    Blocks the calling thread until speech is detected, so run it from the
    dialog worker thread, never the camera loop.
    """

    def __init__(
        self,
        *,
        sample_rate_hz: int = 16_000,
        block_seconds: float = 0.1,
        max_seconds: float = 15.0,
        silence_seconds: float = 0.9,
        speech_rms: float = 0.008,
    ) -> None:
        import sounddevice as sd

        self.sd = sd
        self.sample_rate_hz = sample_rate_hz
        self.block_size = max(1, int(block_seconds * sample_rate_hz))
        self.max_seconds = max_seconds
        self.silence_seconds = silence_seconds
        self.speech_rms = speech_rms

    def capture_utterance(self, timeout_s: float = 0.0) -> AudioCapture | None:
        frames = self._record()
        if frames is None:
            return None
        return AudioCapture(audio_bytes=self._wav_bytes(frames), sample_rate_hz=self.sample_rate_hz, channels=1, mode="voice")

    def _record(self):
        import numpy as np

        max_blocks = int(self.max_seconds / (self.block_size / self.sample_rate_hz))
        silence_blocks = int(self.silence_seconds / (self.block_size / self.sample_rate_hz))
        chunks = []
        speaking = False
        quiet_run = 0
        with self.sd.InputStream(samplerate=self.sample_rate_hz, channels=1, dtype="int16") as stream:
            for _ in range(max_blocks):
                block, _overflowed = stream.read(self.block_size)
                audio = np.frombuffer(block, dtype=np.int16).astype(np.float32) / 32768.0
                rms = float(np.sqrt(np.mean(audio**2)))
                if rms >= self.speech_rms:
                    speaking = True
                    quiet_run = 0
                elif speaking:
                    quiet_run += 1
                if speaking:
                    chunks.append(block)
                    if quiet_run >= silence_blocks:
                        break
        if not speaking or not chunks:
            return None
        return b"".join(chunks)

    def _wav_bytes(self, frames: bytes) -> bytes:
        import io
        import wave

        buffer = io.BytesIO()
        with wave.open(buffer, "wb") as wav_file:
            wav_file.setnchannels(1)
            wav_file.setsampwidth(2)
            wav_file.setframerate(self.sample_rate_hz)
            wav_file.writeframes(frames)
        return buffer.getvalue()


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
