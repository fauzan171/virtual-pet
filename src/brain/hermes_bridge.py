"""Bridge that adapts a Hermes-style action plan into the pet brain interface."""

from __future__ import annotations

from pathlib import Path

from src.agent.coordinator import AgentCoordinator
from src.agent.hermes_like import HermesLikePlanner, HermesPlannerConfig
from src.agent.persistence import JsonAgentPersistence
from src.agent.dialog_loop import DialogueLoop
from src.brain.base import BrainResponse, PetBrain
from src.core.models import InteractionEvent, PetContext


class HermesBridgeBrain(PetBrain):
    provider_name = "hermes-bridge"

    def __init__(self, persona: str = "playful hologram fox", memory_path: str | Path | None = None) -> None:
        planner = HermesLikePlanner(HermesPlannerConfig(persona=persona))
        persistence = JsonAgentPersistence(memory_path) if memory_path is not None else None
        self.coordinator = AgentCoordinator(planner=planner, persistence=persistence)

    def generate(
        self,
        *,
        context: PetContext,
        event: InteractionEvent | None,
        suggested_state: str,
        is_idle_tick: bool,
    ) -> BrainResponse:
        plan = self.coordinator.handle(context=context, event=event, user_utterance=None)
        return BrainResponse(
            subtitle=plan.reply,
            voice_line=plan.reply if plan.should_speak else None,
            mood=plan.emotion,
            animation=plan.animation,
            emote=plan.emote,
            color=plan.color_rgb,
            movement=plan.movement,
        )

    def preview_dialog(self, context: PetContext, user_utterance: str) -> str:
        plan = self.coordinator.handle(context=context, event=None, user_utterance=user_utterance)
        return f"{plan.reply} | move={plan.movement.target_anchor} | memory={self.coordinator.session.memory.summary()}"

    def build_dialog_loop(self, *, tts=None, stt=None, listener=None) -> DialogueLoop:
        return DialogueLoop(coordinator=self.coordinator, tts=tts, stt=stt, listener=listener)
