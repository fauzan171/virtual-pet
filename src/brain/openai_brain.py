"""Optional OpenAI-compatible dialogue provider with local visual reactions."""

from __future__ import annotations

import os

from src.agent.coordinator import AgentCoordinator
from src.agent.dialog_loop import DialogueLoop
from src.agent.remote_planner import RemotePlanner, RemotePlannerConfig
from src.brain.base import BrainResponse, PetBrain
from src.brain.local_brain import LocalPetBrain
from src.core.models import InteractionEvent, PetContext


class OpenAIPetBrain(PetBrain):
    provider_name = "openai-compatible"

    def __init__(
        self,
        model: str,
        api_key: str,
        api_base: str,
        *,
        timeout_s: float = 10.0,
        persona: str = "playful hologram fox",
    ) -> None:
        self.model = model
        self.api_key = api_key
        self.api_base = api_base.rstrip("/")
        self.fallback = LocalPetBrain()
        planner = RemotePlanner(
            RemotePlannerConfig(
                model=model,
                api_key=api_key,
                api_base=self.api_base,
                persona=persona,
                timeout_s=timeout_s,
                api_key_env="OPENAI_API_KEY",
            )
        )
        self.coordinator = AgentCoordinator(planner=planner)

    @classmethod
    def from_env(cls) -> "OpenAIPetBrain | None":
        api_key = os.environ.get("OPENAI_API_KEY")
        model = os.environ.get("HOLOPET_OPENAI_MODEL", "gpt-4.1-mini")
        api_base = os.environ.get("OPENAI_API_BASE", "https://api.openai.com/v1")
        timeout_s = float(os.environ.get("HOLOPET_OPENAI_TIMEOUT_S", "10"))
        if not api_key:
            return None
        return cls(model=model, api_key=api_key, api_base=api_base, timeout_s=timeout_s)

    def generate(
        self,
        *,
        context: PetContext,
        event: InteractionEvent | None,
        suggested_state: str,
        is_idle_tick: bool,
    ) -> BrainResponse:
        # Camera events run at frame rate.  Keep them deterministic and local;
        # the application invokes the dialogue loop below on its worker thread
        # so remote latency can never stall tracking or rendering.
        return self.fallback.generate(
            context=context,
            event=event,
            suggested_state=suggested_state,
            is_idle_tick=is_idle_tick,
        )

    def build_dialog_loop(self, *, tts=None, stt=None, listener=None) -> DialogueLoop:
        return DialogueLoop(coordinator=self.coordinator, tts=tts, stt=stt, listener=listener)
