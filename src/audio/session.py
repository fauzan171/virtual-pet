"""Half-duplex voice lifecycle for capture, planning, and playback."""

from __future__ import annotations

import math
import queue
import threading
import time
from dataclasses import dataclass, field
from enum import Enum
from typing import Callable, Generic, TypeVar

from src.audio.listener import MicrophoneListener
from src.audio.stt import SpeechToText
from src.audio.tts import TextToSpeech


ResultT = TypeVar("ResultT")


class VoiceState(str, Enum):
    IDLE = "idle"
    LISTENING = "listening"
    TRANSCRIBING = "transcribing"
    THINKING = "thinking"
    SPEAKING = "speaking"
    ERROR = "error"


@dataclass(frozen=True, slots=True)
class VoiceStatus:
    state: VoiceState
    turn_id: int = 0
    transcript: str = ""
    confidence: float = 0.0
    error: str | None = None
    changed_at: float = field(default_factory=time.monotonic)


@dataclass(slots=True)
class _SpeechRequest:
    text: str
    done: threading.Event = field(default_factory=threading.Event)
    completed: bool = False


class VoiceSession(Generic[ResultT]):
    """Own one half-duplex voice pipeline.

    Microphone capture never overlaps TTS.  A completed plan is published to
    ``result_sink`` before playback begins, so visual reactions do not wait for
    a slow or blocking speech backend.
    """

    def __init__(
        self,
        *,
        listener: MicrophoneListener,
        stt: SpeechToText,
        planner: Callable[[str], ResultT],
        tts: TextToSpeech,
        result_sink: Callable[[ResultT], None] | None = None,
        speech_text: Callable[[ResultT], str | None] | None = None,
        status_sink: Callable[[VoiceStatus], None] | None = None,
        capture_timeout_s: float = 0.25,
        min_transcript_confidence: float = 0.35,
        failure_backoff_s: float = 0.25,
        post_speech_guard_ms: int = 250,
        min_confidence: float | None = None,
    ) -> None:
        self.listener = listener
        self.stt = stt
        self.planner = planner
        self.tts = tts
        self.result_sink = result_sink
        self.speech_text = speech_text or (lambda _result: None)
        self.status_sink = status_sink
        self.capture_timeout_s = max(0.0, float(capture_timeout_s))
        if min_confidence is not None:
            min_transcript_confidence = min_confidence
        self.min_transcript_confidence = min(1.0, max(0.0, float(min_transcript_confidence)))
        self.failure_backoff_s = max(0.0, float(failure_backoff_s))
        self.post_speech_guard_s = max(0.0, float(post_speech_guard_ms) / 1000.0)

        self._status_lock = threading.Lock()
        self._status = VoiceStatus(VoiceState.IDLE)
        self._turn_lock = threading.Lock()
        self._lifecycle_lock = threading.Lock()
        self._speech_lock = threading.Lock()
        self._publish_lock = threading.RLock()
        self._stop_event = threading.Event()
        self._interrupt_speech_event = threading.Event()
        self._running_event = threading.Event()
        self._speech_requests: queue.Queue[_SpeechRequest] = queue.Queue(maxsize=1)
        self._pending_speech_text: str | None = None
        self._active_speech_text: str | None = None
        self._thread: threading.Thread | None = None
        self._turn_id = 0
        self.last_spoken = False

    @property
    def status(self) -> VoiceStatus:
        with self._status_lock:
            return self._status

    @property
    def state(self) -> VoiceState:
        return self.status.state

    @property
    def running(self) -> bool:
        return self._running_event.is_set()

    def start(self) -> bool:
        """Start the capture loop in a daemon thread.

        Returns ``False`` when the session is already running.
        """

        with self._lifecycle_lock:
            if self._thread is not None and self._thread.is_alive():
                return False
            self._stop_event.clear()
            self._thread = threading.Thread(
                target=self.run_forever,
                name="holopet-voice-session",
                daemon=True,
            )
            # Publish running before start returns so a same-frame camera line
            # is queued instead of falling through to synchronous TTS.
            self._running_event.set()
            try:
                self._thread.start()
            except Exception:
                self._running_event.clear()
                self._thread = None
                raise
            return True

    def join(self, timeout: float | None = None) -> None:
        with self._lifecycle_lock:
            thread = self._thread
        if thread is not None and thread is not threading.current_thread():
            thread.join(timeout=timeout)

    def stop(self) -> None:
        """Cancel capture and playback, then let the worker exit."""

        self._stop_event.set()
        self._safe_cancel_listener()
        self._safe_cancel_tts()
        self._cancel_pending_speech()
        # A sink that began just before stop is allowed to finish, but once
        # stop returns no stale planner result may be published afterward.
        with self._publish_lock:
            pass
        self._set_status(VoiceState.IDLE)

    def run_forever(self) -> None:
        """Run capture turns until ``stop`` is requested."""

        self._running_event.set()
        try:
            while not self._stop_event.is_set():
                request = self._take_speech_request()
                if request is None:
                    result = self.run_turn()
                    if result is None and not self._stop_event.is_set():
                        self._stop_event.wait(0.02)
                    continue
                self._handle_speech_request(request)
        finally:
            self._safe_cancel_listener()
            self._safe_cancel_tts()
            self._cancel_pending_speech()
            self._running_event.clear()
            self._set_status(VoiceState.IDLE)

    def run_turn(self) -> ResultT | None:
        """Capture and process at most one utterance."""

        if self._stop_event.is_set() or not self._turn_lock.acquire(blocking=False):
            return None
        result: ResultT | None = None
        transcript_text = ""
        confidence = 0.0
        self.last_spoken = False
        self._turn_id += 1
        turn_id = self._turn_id
        try:
            self.listener.reset()
            self._set_status(VoiceState.LISTENING, turn_id=turn_id)
            capture = self.listener.capture_utterance(
                timeout_s=self.capture_timeout_s,
                cancel_event=self._stop_event,
            )
            if self._stop_event.is_set():
                self._set_status(VoiceState.IDLE, turn_id=turn_id)
                return None
            if capture is None:
                self._set_status(VoiceState.IDLE, turn_id=turn_id)
                return None

            self._set_status(VoiceState.TRANSCRIBING, turn_id=turn_id)
            transcript = self.stt.transcribe(capture)
            if self._stop_event.is_set():
                self._set_status(VoiceState.IDLE, turn_id=turn_id)
                return None
            transcript_text = transcript.text.strip()
            confidence = self._safe_confidence(transcript.confidence)
            if not transcript_text or confidence < self.min_transcript_confidence:
                self._set_status(
                    VoiceState.IDLE,
                    turn_id=turn_id,
                    transcript=transcript_text,
                    confidence=confidence,
                )
                return None

            self._set_status(
                VoiceState.THINKING,
                turn_id=turn_id,
                transcript=transcript_text,
                confidence=confidence,
            )
            # A real user utterance always outranks cosmetic camera chatter.
            # Switch state first so no new camera request can slip between the
            # drain and planning transition.
            self._cancel_pending_speech()
            result = self.planner(transcript_text)
            if self._stop_event.is_set():
                self._set_status(VoiceState.IDLE, turn_id=turn_id)
                return None
            if result is None:
                self._set_status(
                    VoiceState.IDLE,
                    turn_id=turn_id,
                    transcript=transcript_text,
                    confidence=confidence,
                )
                return None

            self._interrupt_speech_event.clear()
            self._set_status(
                VoiceState.SPEAKING,
                turn_id=turn_id,
                transcript=transcript_text,
                confidence=confidence,
            )
            with self._publish_lock:
                if self._stop_event.is_set():
                    self._set_status(VoiceState.IDLE, turn_id=turn_id)
                    return None
                if self.result_sink is not None:
                    self.result_sink(result)
            self.last_spoken = self._speak_now(self.speech_text(result))
            self._set_status(
                VoiceState.IDLE,
                turn_id=turn_id,
                transcript=transcript_text,
                confidence=confidence,
            )
            return result
        except Exception as error:
            self._recover_from_error(
                error,
                turn_id=turn_id,
                transcript=transcript_text,
                confidence=confidence,
            )
            return result
        finally:
            self._turn_lock.release()

    def request_speech(
        self,
        text: str | None,
        *,
        wait: bool = False,
        interrupt: bool = False,
    ) -> bool:
        """Speak through the session without opening a second audio path.

        While the background loop is active, requests are queued behind the
        current capture.  A valid user transcript drops those cosmetic lines;
        a capture timeout lets the oldest request play on the next loop.
        ``wait=False`` reports queue acceptance; ``wait=True`` reports playback
        completion.
        """

        cleaned = (text or "").strip()
        if not cleaned or self._stop_event.is_set():
            return False
        if not self.running:
            request = _SpeechRequest(cleaned)
            self._handle_speech_request(request)
            return request.completed

        state = self.state
        if state in {VoiceState.TRANSCRIBING, VoiceState.THINKING}:
            return False
        if state == VoiceState.SPEAKING and not interrupt:
            return False

        request = _SpeechRequest(cleaned)
        with self._speech_lock:
            # Recheck under the same lock used by the user's pending-request
            # drain.  This closes the LISTENING -> THINKING TOCTOU window.
            if self._stop_event.is_set():
                return False
            state = self.state
            if state in {VoiceState.TRANSCRIBING, VoiceState.THINKING}:
                return False
            if state == VoiceState.SPEAKING and not interrupt:
                return False
            if cleaned in {self._pending_speech_text, self._active_speech_text}:
                return False
            if self._pending_speech_text is not None:
                return False
            try:
                self._speech_requests.put_nowait(request)
            except queue.Full:
                return False
            self._pending_speech_text = cleaned
            if state == VoiceState.SPEAKING and interrupt:
                # Publish the non-blocking interrupt flag before the worker can
                # take this queued line under the same lock. Backend cancel
                # still happens on the voice worker, never the camera thread.
                self._interrupt_speech_event.set()
        if not wait:
            return True
        request.done.wait()
        return request.completed

    def speak(self, text: str | None) -> bool:
        """Compatibility alias for non-blocking session-owned speech."""

        return self.request_speech(text, wait=False)

    def interrupt_speech(self) -> bool:
        """Request worker-owned cancellation of the current spoken line."""

        if self._stop_event.is_set() or self.state != VoiceState.SPEAKING:
            return False
        self._interrupt_speech_event.set()
        return True

    def _handle_speech_request(self, request: _SpeechRequest) -> None:
        if self._stop_event.is_set():
            request.done.set()
            return
        with self._turn_lock:
            try:
                self._turn_id += 1
                turn_id = self._turn_id
                self._interrupt_speech_event.clear()
                self._set_status(VoiceState.SPEAKING, turn_id=turn_id)
                request.completed = self._speak_now(request.text)
                self._set_status(VoiceState.IDLE, turn_id=turn_id)
            except Exception as error:
                self._recover_from_error(error, turn_id=self._turn_id)
            finally:
                with self._speech_lock:
                    if self._active_speech_text == request.text:
                        self._active_speech_text = None
                request.done.set()

    def _speak_now(self, text: str | None) -> bool:
        if not text or self._stop_event.is_set():
            return False
        started = self.tts.speak(text)
        if not started:
            return False
        while not self._stop_event.is_set():
            if self._interrupt_speech_event.is_set():
                self._interrupt_speech_event.clear()
                self._safe_cancel_tts()
                if self.post_speech_guard_s:
                    self._stop_event.wait(self.post_speech_guard_s)
                return False
            if self.tts.wait(timeout_s=0.05):
                if self.post_speech_guard_s:
                    self._stop_event.wait(self.post_speech_guard_s)
                return not self._stop_event.is_set()
        self._safe_cancel_tts()
        return False

    def _recover_from_error(
        self,
        error: Exception,
        *,
        turn_id: int,
        transcript: str = "",
        confidence: float = 0.0,
    ) -> None:
        message = f"{type(error).__name__}: {error}"
        self._set_status(
            VoiceState.ERROR,
            turn_id=turn_id,
            transcript=transcript,
            confidence=confidence,
            error=message,
        )
        self._safe_cancel_tts()
        if not self._stop_event.is_set() and self.failure_backoff_s:
            self._stop_event.wait(self.failure_backoff_s)
        self._set_status(
            VoiceState.IDLE,
            turn_id=turn_id,
            transcript=transcript,
            confidence=confidence,
        )

    def _set_status(
        self,
        state: VoiceState,
        *,
        turn_id: int | None = None,
        transcript: str = "",
        confidence: float = 0.0,
        error: str | None = None,
    ) -> None:
        status = VoiceStatus(
            state=state,
            turn_id=self._turn_id if turn_id is None else turn_id,
            transcript=transcript,
            confidence=confidence,
            error=error,
        )
        with self._status_lock:
            self._status = status
        if self.status_sink is not None:
            try:
                self.status_sink(status)
            except Exception:
                # UI/status reporting must not kill the audio worker.
                pass

    def _cancel_pending_speech(self) -> None:
        with self._speech_lock:
            while True:
                try:
                    request = self._speech_requests.get_nowait()
                except queue.Empty:
                    self._pending_speech_text = None
                    return
                request.done.set()

    def _safe_cancel_listener(self) -> None:
        try:
            self.listener.cancel()
        except Exception:
            # Cancellation is best effort; lifecycle cleanup must still finish.
            pass

    def _safe_cancel_tts(self) -> None:
        try:
            self.tts.cancel()
        except Exception:
            # A broken audio backend must not kill turn recovery or shutdown.
            pass

    def _take_speech_request(self) -> _SpeechRequest | None:
        with self._speech_lock:
            try:
                request = self._speech_requests.get_nowait()
            except queue.Empty:
                return None
            self._pending_speech_text = None
            self._active_speech_text = request.text
            return request

    @staticmethod
    def _safe_confidence(value: float) -> float:
        try:
            confidence = float(value)
        except (TypeError, ValueError):
            return 0.0
        if not math.isfinite(confidence):
            return 0.0
        return min(1.0, max(0.0, confidence))
