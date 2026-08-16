"""Dialogue loop that connects utterances, planning, subtitles, rendering, and audio."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Callable

from src.agent.coordinator import AgentCoordinator
from src.agent.schema import AgentActionPlan
from src.audio.listener import MicrophoneListener, NullMicrophoneListener
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
    spoken: bool


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

    def capture_and_handle(self, *, context: PetContext, tracking: TrackingSnapshot | None = None) -> DialogueTurnResult | None:
        capture = self.listener.capture_utterance()
        if capture is None:
            return None
        transcript = self.stt.transcribe(capture)
        return self.handle_text(context=context, utterance=transcript.text, tracking=tracking)

    def handle_text(
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
        if self.subtitle_sink is not None:
            self.subtitle_sink(plan.reply)
        if self.plan_sink is not None:
            self.plan_sink(plan)
        spoken = self.tts.speak(plan.reply if plan.should_speak else None)
        return DialogueTurnResult(
            utterance=utterance,
            plan=plan,
            memory_summary=self.coordinator.session.memory.summary(),
            spoken=spoken,
        )

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
