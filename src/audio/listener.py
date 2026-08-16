"""Microphone capture abstractions for local-first dialogue input."""

from __future__ import annotations

import select
import sys
import threading
import time
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

    def capture_utterance(
        self,
        timeout_s: float = 3.0,
        cancel_event: threading.Event | None = None,
    ) -> AudioCapture | None:
        raise NotImplementedError

    def cancel(self) -> None:
        """Interrupt an in-flight capture, if the backend is blocking."""

    def reset(self) -> None:
        """Clear a previous cancellation before starting another capture."""


class NullMicrophoneListener(MicrophoneListener):
    def capture_utterance(
        self,
        timeout_s: float = 3.0,
        cancel_event: threading.Event | None = None,
    ) -> AudioCapture | None:
        return None


class MockMicrophoneListener(MicrophoneListener):
    """Queue-based self-test listener that avoids device dependencies."""

    def __init__(self, captures: list[AudioCapture] | None = None) -> None:
        self._captures = deque(captures or [])
        self._condition = threading.Condition()
        self._cancel_event = threading.Event()

    def push(self, capture: AudioCapture) -> None:
        with self._condition:
            self._captures.append(capture)
            self._condition.notify()

    def capture_utterance(
        self,
        timeout_s: float = 3.0,
        cancel_event: threading.Event | None = None,
    ) -> AudioCapture | None:
        deadline = time.monotonic() + max(0.0, timeout_s)
        with self._condition:
            while not self._captures:
                if self._cancel_event.is_set() or (cancel_event is not None and cancel_event.is_set()):
                    return None
                remaining = deadline - time.monotonic()
                if remaining <= 0:
                    return None
                self._condition.wait(timeout=min(remaining, 0.1))
            return self._captures.popleft()

    def cancel(self) -> None:
        self._cancel_event.set()
        with self._condition:
            self._condition.notify_all()

    def reset(self) -> None:
        self._cancel_event.clear()


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
        self._cancel_event = threading.Event()

    def validate_input(self) -> None:
        """Open and close the configured input once to surface device errors.

        Importing ``sounddevice`` alone does not validate the selected device
        or macOS microphone permission; those errors otherwise appear forever
        inside the background worker where typed fallback is no longer easy.
        """

        with self.sd.InputStream(
            samplerate=self.sample_rate_hz,
            channels=1,
            dtype="int16",
        ):
            pass

    def capture_utterance(
        self,
        timeout_s: float = 0.0,
        cancel_event: threading.Event | None = None,
    ) -> AudioCapture | None:
        frames = self._record(timeout_s=timeout_s, cancel_event=cancel_event)
        if frames is None:
            return None
        return AudioCapture(audio_bytes=self._wav_bytes(frames), sample_rate_hz=self.sample_rate_hz, channels=1, mode="voice")

    def cancel(self) -> None:
        self._cancel_event.set()

    def reset(self) -> None:
        self._cancel_event.clear()

    def _record(self, *, timeout_s: float = 0.0, cancel_event: threading.Event | None = None):
        import numpy as np

        max_blocks = int(self.max_seconds / (self.block_size / self.sample_rate_hz))
        silence_blocks = int(self.silence_seconds / (self.block_size / self.sample_rate_hz))
        speech_deadline = time.monotonic() + timeout_s if timeout_s > 0 else None
        chunks = []
        speaking = False
        quiet_run = 0
        utterance_blocks = 0
        with self.sd.InputStream(samplerate=self.sample_rate_hz, channels=1, dtype="int16") as stream:
            while utterance_blocks < max_blocks:
                if self._cancel_event.is_set() or (cancel_event is not None and cancel_event.is_set()):
                    return None
                if not speaking and speech_deadline is not None and time.monotonic() >= speech_deadline:
                    return None
                block, _overflowed = stream.read(self.block_size)
                audio = np.frombuffer(block, dtype=np.int16).astype(np.float32) / 32768.0
                rms = float(np.sqrt(np.mean(audio**2)))
                if rms >= self.speech_rms:
                    speaking = True
                    quiet_run = 0
                elif speaking:
                    quiet_run += 1
                if speaking:
                    utterance_blocks += 1
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
        self._cancel_event = threading.Event()

    def capture_utterance(
        self,
        timeout_s: float = 0.0,
        cancel_event: threading.Event | None = None,
    ) -> AudioCapture | None:
        deadline = time.monotonic() + max(0.0, timeout_s)
        while True:
            if self._cancel_event.is_set() or (cancel_event is not None and cancel_event.is_set()):
                return None
            remaining = max(0.0, deadline - time.monotonic())
            readable, _, _ = select.select([sys.stdin], [], [], min(remaining, 0.1))
            if readable:
                break
            if remaining <= 0:
                return None
        line = sys.stdin.readline()
        if not line:
            return None
        text = line.strip()
        if not text:
            return None
        return AudioCapture(audio_bytes=text.encode("utf-8"), prompt_text=text, mode=self.mode)

    def cancel(self) -> None:
        self._cancel_event.set()

    def reset(self) -> None:
        self._cancel_event.clear()
