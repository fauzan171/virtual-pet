"""Dialogue loop that connects utterances, planning, subtitles, rendering, and audio."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Callable

from src.agent.coordinator import AgentCoordinator
from src.agent.schema import AgentActionPlan
from src.audio.listener import MicrophoneListener, NullMicrophoneListener
from src.audio.session import VoiceSession, VoiceState, VoiceStatus
from src.audio.stt import MockSpeechToText, SpeechToText
from src.audio.tts import NullTextToSpeech, TextToSpeech
from src.core.models import PetContext, TrackingSnapshot


SubtitleSink = Callable[[str], None]
PlanSink = Callable[[AgentActionPlan], None]


@dataclass(slots=True)
class DialogueTurnResult:
    utterance: str
    plan: AgentActionPlan
    memory_summary: str
    spoken: bool = False


class DialogueLoop:
    def __init__(
        self,
        *,
        coordinator: AgentCoordinator,
        listener: MicrophoneListener | None = None,
        stt: SpeechToText | None = None,
        tts: TextToSpeech | None = None,
        subtitle_sink: SubtitleSink | None = None,
        plan_sink: PlanSink | None = None,
    ) -> None:
        self.coordinator = coordinator
        self.listener = listener or NullMicrophoneListener()
        self.stt = stt or MockSpeechToText()
        self.tts = tts or NullTextToSpeech()
        self.subtitle_sink = subtitle_sink
        self.plan_sink = plan_sink
        self.voice_session: VoiceSession[DialogueTurnResult] | None = None

    def capture_and_handle(self, *, context: PetContext, tracking: TrackingSnapshot | None = None) -> DialogueTurnResult | None:
        """Process one safe voice turn while preserving the original API."""

        session = VoiceSession(
            listener=self.listener,
            stt=self.stt,
            planner=lambda utterance: self._plan_text(context=context, utterance=utterance, tracking=tracking),
            tts=self.tts,
            result_sink=self._publish_result,
            speech_text=self._speech_text,
        )
        self.voice_session = session
        result = session.run_turn()
        if result is not None:
            result.spoken = session.last_spoken
        return result

    def handle_text(
        self,
        *,
        context: PetContext,
        utterance: str,
        tracking: TrackingSnapshot | None = None,
    ) -> DialogueTurnResult:
        result = self._plan_text(context=context, utterance=utterance, tracking=tracking)
        self._publish_result(result)
        spoken = self.tts.speak(self._speech_text(result))
        if spoken:
            spoken = self.tts.wait()
        result.spoken = spoken
        return result

    def start_voice_session(
        self,
        *,
        context_supplier: Callable[[], PetContext],
        tracking_supplier: Callable[[], TrackingSnapshot | None] | None = None,
        result_sink: Callable[[DialogueTurnResult], None] | None = None,
        status_sink: Callable[[VoiceStatus], None] | None = None,
        capture_timeout_s: float = 0.25,
        min_transcript_confidence: float = 0.35,
        failure_backoff_s: float = 0.25,
        post_speech_guard_ms: int = 250,
    ) -> VoiceSession[DialogueTurnResult]:
        """Start the long-lived voice worker used by the camera demo."""

        self.stop_voice_session()
        if self.voice_session is not None and self.voice_session.running:
            raise RuntimeError("previous voice session is still stopping")

        def plan(utterance: str) -> DialogueTurnResult:
            tracking = tracking_supplier() if tracking_supplier is not None else None
            return self._plan_text(
                context=context_supplier(),
                utterance=utterance,
                tracking=tracking,
            )

        def publish(result: DialogueTurnResult) -> None:
            self._publish_result(result)
            if result_sink is not None:
                result_sink(result)

        session = VoiceSession(
            listener=self.listener,
            stt=self.stt,
            planner=plan,
            tts=self.tts,
            result_sink=publish,
            speech_text=self._speech_text,
            status_sink=status_sink,
            capture_timeout_s=capture_timeout_s,
            min_transcript_confidence=min_transcript_confidence,
            failure_backoff_s=failure_backoff_s,
            post_speech_guard_ms=post_speech_guard_ms,
        )
        self.voice_session = session
        session.start()
        return session

    def stop_voice_session(self, join_timeout_s: float = 1.0) -> None:
        session = self.voice_session
        if session is None:
            return
        session.stop()
        session.join(timeout=join_timeout_s)

    def request_speech(
        self,
        text: str | None,
        *,
        wait: bool = False,
        interrupt: bool = False,
    ) -> bool:
        """Route camera and dialogue speech through the active half-duplex path."""

        session = self.voice_session
        if session is not None:
            if session.running:
                return session.request_speech(text, wait=wait, interrupt=interrupt)
            # Once a session has owned the mic/TTS path, never fall back to a
            # second camera-thread TTS path if that worker stops unexpectedly.
            return False
        spoken = self.tts.speak(text)
        if spoken and wait:
            return self.tts.wait()
        return spoken

    def interrupt_speech(self) -> bool:
        session = self.voice_session
        if session is None or not session.running:
            return False
        return session.interrupt_speech()

    @property
    def voice_status(self) -> VoiceStatus:
        if self.voice_session is None:
            return VoiceStatus(VoiceState.IDLE)
        return self.voice_session.status

    def _plan_text(
        self,
        *,
        context: PetContext,
        utterance: str,
        tracking: TrackingSnapshot | None = None,
    ) -> DialogueTurnResult:
        tracking_confidence = tracking.tracking_confidence if tracking is not None else context.tracking_confidence
        planning_context = PetContext(
            state=context.state,
            mood=context.mood,
            bond=context.bond,
            energy=context.energy,
            interaction_count=context.interaction_count,
            last_event=context.last_event,
            memory_summary=context.memory_summary,
            known_user_name=context.known_user_name,
            tracking_confidence=tracking_confidence,
        )
        plan = self.coordinator.handle(context=planning_context, event=None, user_utterance=utterance)
        self._apply_tracking_feedback(plan, tracking_confidence)
        return DialogueTurnResult(
            utterance=utterance,
            plan=plan,
            memory_summary=self.coordinator.session.memory.summary(),
        )

    def _publish_result(self, result: DialogueTurnResult) -> None:
        if self.subtitle_sink is not None:
            self.subtitle_sink(result.plan.reply)
        if self.plan_sink is not None:
            self.plan_sink(result.plan)

    @staticmethod
    def _speech_text(result: DialogueTurnResult) -> str | None:
        return result.plan.reply if result.plan.should_speak else None

    def run_self_test(
        self,
        *,
        context: PetContext,
        utterances: list[str],
        tracking: TrackingSnapshot | None = None,
    ) -> list[DialogueTurnResult]:
        return [self.handle_text(context=context, utterance=utterance, tracking=tracking) for utterance in utterances]

    @staticmethod
    def _apply_tracking_feedback(plan: AgentActionPlan, tracking_confidence: float) -> None:
        if plan.movement_requested and tracking_confidence < 0.35:
            plan.reply = "Aku mau bergerak, tapi tracking tubuhmu lagi goyang sedikit."
