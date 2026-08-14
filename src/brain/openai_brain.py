"""Optional OpenAI-compatible provider for dynamic pet responses."""

from __future__ import annotations

import json
import os
import urllib.error
import urllib.request

from src.brain.base import BrainResponse, PetBrain, default_movement_for_state
from src.brain.local_brain import LocalPetBrain
from src.core.models import InteractionEvent, PetContext


class OpenAIPetBrain(PetBrain):
    provider_name = "openai-compatible"

    def __init__(self, model: str, api_key: str, api_base: str) -> None:
        self.model = model
        self.api_key = api_key
        self.api_base = api_base.rstrip("/")
        self.fallback = LocalPetBrain()

    @classmethod
    def from_env(cls) -> "OpenAIPetBrain | None":
        api_key = os.environ.get("OPENAI_API_KEY")
        model = os.environ.get("HOLOPET_OPENAI_MODEL", "gpt-4.1-mini")
        api_base = os.environ.get("OPENAI_API_BASE", "https://api.openai.com/v1")
        if not api_key:
            return None
        return cls(model=model, api_key=api_key, api_base=api_base)

    def generate(
        self,
        *,
        context: PetContext,
        event: InteractionEvent | None,
        suggested_state: str,
        is_idle_tick: bool,
    ) -> BrainResponse:
        try:
            return self._request_response(context=context, event=event, suggested_state=suggested_state, is_idle_tick=is_idle_tick)
        except (urllib.error.URLError, TimeoutError, ValueError, KeyError, json.JSONDecodeError):
            return self.fallback.generate(
                context=context,
                event=event,
                suggested_state=suggested_state,
                is_idle_tick=is_idle_tick,
            )

    def _request_response(
        self,
        *,
        context: PetContext,
        event: InteractionEvent | None,
        suggested_state: str,
        is_idle_tick: bool,
    ) -> BrainResponse:
        payload = {
            "model": self.model,
            "temperature": 0.8,
            "response_format": {"type": "json_object"},
            "messages": [
                {
                    "role": "system",
                    "content": (
                        "You are HoloPet, a cute hologram robotic pet. "
                        "Respond in short stage-friendly lines. "
                        "Return JSON with keys: subtitle, voice_line, mood, animation, emote, color_rgb."
                    ),
                },
                {
                    "role": "user",
                    "content": json.dumps(
                        {
                            "context": {
                                "state": context.state,
                                "mood": context.mood,
                                "bond": context.bond,
                                "energy": context.energy,
                                "interaction_count": context.interaction_count,
                                "last_event": context.last_event,
                            },
                            "event": event.name if event else None,
                            "suggested_state": suggested_state,
                            "idle_tick": is_idle_tick,
                        }
                    ),
                },
            ],
        }
        body = json.dumps(payload).encode("utf-8")
        req = urllib.request.Request(
            f"{self.api_base}/chat/completions",
            data=body,
            headers={
                "Authorization": f"Bearer {self.api_key}",
                "Content-Type": "application/json",
            },
            method="POST",
        )
        with urllib.request.urlopen(req, timeout=10) as resp:
            raw = json.loads(resp.read().decode("utf-8"))
        content = raw["choices"][0]["message"]["content"]
        data = json.loads(content)
        color = tuple(int(x) for x in data.get("color_rgb", [140, 240, 255]))
        return BrainResponse(
            subtitle=str(data["subtitle"]),
            voice_line=str(data.get("voice_line") or data["subtitle"]),
            mood=str(data.get("mood", "playful")),
            animation=str(data.get("animation", "hover")),
            emote=str(data.get("emote", "idle")),
            color=(color[0], color[1], color[2]),
            movement=default_movement_for_state(suggested_state),
            response_source=self.provider_name,
        )
