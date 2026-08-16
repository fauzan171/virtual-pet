"""Bridge that adapts the remote action planner into the pet brain interface."""

from __future__ import annotations

from pathlib import Path

from src.agent.coordinator import AgentCoordinator
from src.agent.dialog_loop import DialogueLoop
from src.agent.persistence import JsonAgentPersistence
from src.agent.remote_planner import RemotePlanner, RemotePlannerConfig
from src.brain.base import BrainResponse, PetBrain
from src.brain.local_brain import LocalPetBrain
from src.core.models import InteractionEvent, PetContext


class RemoteBridgeBrain(PetBrain):
    provider_name = "remote-planner"

    def __init__(
        self,
        *,
        model: str,
        api_key: str,
        api_base: str,
        memory_path: str | Path | None = None,
        persona: str = "playful hologram fox",
        timeout_s: float = 8.0,
        api_key_env: str = "HOLOPET_REMOTE_API_KEY",
    ) -> None:
        planner = RemotePlanner(
            RemotePlannerConfig(
                model=model,
                api_key=api_key,
                api_base=api_base,
                persona=persona,
                timeout_s=timeout_s,
                api_key_env=api_key_env,
            )
        )
        persistence = JsonAgentPersistence(memory_path) if memory_path is not None else None
        self.coordinator = AgentCoordinator(planner=planner, persistence=persistence)
        self.gesture_brain = LocalPetBrain()

    @classmethod
    def from_env(cls, *, memory_path: str | Path | None = None) -> "RemoteBridgeBrain | None":
        planner = RemotePlanner.from_env()
        if planner is None:
            return None
        return cls(
            model=planner.config.model,
            api_key=planner.config.api_key,
            api_base=planner.config.api_base,
            memory_path=memory_path,
            persona=planner.config.persona,
            timeout_s=planner.config.timeout_s,
            api_key_env=planner.config.api_key_env,
        )

    def generate(
        self,
        *,
        context: PetContext,
        event: InteractionEvent | None,
        suggested_state: str,
        is_idle_tick: bool,
    ) -> BrainResponse:
        return self.gesture_brain.generate(
            context=context,
            event=event,
            suggested_state=suggested_state,
            is_idle_tick=is_idle_tick,
        )

    def preview_dialog(self, context: PetContext, user_utterance: str) -> str:
        plan = self.coordinator.handle(context=context, event=None, user_utterance=user_utterance)
        return f"{plan.reply} | move={plan.movement.target_anchor} | memory={self.coordinator.session.memory.summary()}"

    def build_dialog_loop(self, *, tts=None, stt=None, listener=None) -> DialogueLoop:
        return DialogueLoop(coordinator=self.coordinator, tts=tts, stt=stt, listener=listener)
