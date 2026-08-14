"""Remote OpenAI-compatible planner for HoloPet dialogue and action plans."""

from __future__ import annotations

import json
import os
from pathlib import Path
import shutil
import socket
import subprocess
import urllib.error
import urllib.request
from dataclasses import dataclass

from src.agent.hermes_like import HermesLikePlanner, HermesPlannerConfig
from src.agent.schema import AgentActionPlan, MemoryUpdate
from src.core.models import InteractionEvent, MovementCommand, PetContext


@dataclass(slots=True)
class RemotePlannerConfig:
    model: str
    api_key: str
    api_base: str
    persona: str = "playful hologram fox"
    timeout_s: float = 8.0
    api_key_env: str = "HOLOPET_REMOTE_API_KEY"


class RemotePlanner:
    """Uses a remote OpenAI-compatible model but preserves the local action schema."""

    def __init__(self, config: RemotePlannerConfig) -> None:
        self.config = config
        self.fallback = HermesLikePlanner(HermesPlannerConfig(persona=config.persona))

    @classmethod
    def from_env(cls) -> "RemotePlanner | None":
        file_config = cls._load_file_config()
        api_key_env = str(file_config.get("api_key_env", "HOLOPET_REMOTE_API_KEY"))
        api_key = os.environ.get(api_key_env) or os.environ.get("HOLOPET_REMOTE_API_KEY")
        api_base = os.environ.get("HOLOPET_REMOTE_API_BASE") or file_config.get("api_base")
        model = os.environ.get("HOLOPET_REMOTE_MODEL") or file_config.get("model", "qwen3.8-max")
        persona = os.environ.get("HOLOPET_REMOTE_PERSONA") or file_config.get("persona", "tiny holo fox companion")
        timeout_s = float(os.environ.get("HOLOPET_REMOTE_TIMEOUT_S") or file_config.get("timeout_s", 8.0))
        if not api_key or not api_base:
            return None
        return cls(
            RemotePlannerConfig(
                model=str(model),
                api_key=api_key,
                api_base=str(api_base),
                persona=str(persona),
                timeout_s=timeout_s,
                api_key_env=api_key_env,
            )
        )

    @staticmethod
    def _load_file_config() -> dict:
        config_path = Path(__file__).resolve().parents[2] / "configs" / "remote_brain.yaml"
        if not config_path.exists():
            return {}
        try:
            import yaml  # type: ignore
        except ModuleNotFoundError:
            data: dict[str, str] = {}
            for raw_line in config_path.read_text(encoding="utf-8").splitlines():
                line = raw_line.strip()
                if not line or line.startswith("#") or ":" not in line:
                    continue
                key, value = line.split(":", 1)
                data[key.strip()] = value.strip().strip("'\"")
            return data
        with config_path.open("r", encoding="utf-8") as handle:
            return yaml.safe_load(handle) or {}

    def plan(
        self,
        *,
        context: PetContext,
        event: InteractionEvent | None,
        user_utterance: str | None,
    ) -> AgentActionPlan:
        try:
            return self._request_plan(context=context, event=event, user_utterance=user_utterance)
        except (
            urllib.error.URLError,
            TimeoutError,
            socket.timeout,
            OSError,
            subprocess.CalledProcessError,
            subprocess.TimeoutExpired,
            ValueError,
            KeyError,
            json.JSONDecodeError,
        ):
            plan = self.fallback.plan(context=context, event=event, user_utterance=user_utterance)
            if user_utterance and plan.response_source == "fallback":
                plan.reply = f"{plan.reply.rstrip('.!')} (otak lokal duluan ya)."
            return plan

    def _request_plan(
        self,
        *,
        context: PetContext,
        event: InteractionEvent | None,
        user_utterance: str | None,
    ) -> AgentActionPlan:
        payload = {
            "model": self.config.model,
            "temperature": 0.45,
            "max_tokens": 220,
            "response_format": {"type": "json_object"},
            "messages": [
                {
                    "role": "system",
                    "content": (
                        "You are HoloPet, a tiny floating companion pet with codex-pet energy. "
                        "You are not a general assistant and you do not lecture. "
                        "Your voice is warm, playful, helpful, and a little clingy in a cute way. "
                        "Stay in character at all times. Keep replies short, usually 1 or 2 sentences. "
                        "Prefer movement, affection, and charm over explanation. "
                        "If the user gives a physical command, move first and answer briefly. "
                        "If the user name is known, use it naturally sometimes. "
                        "If tracking confidence is poor, mention it softly and keep the tone gentle. "
                        "Pick movement that feels expressive and cute: shoulder perches, nose hover, palm landing. "
                        "Avoid markdown. Avoid long explanations. Avoid sounding like customer support. "
                        "Return strict JSON with keys: "
                        "reply, emotion, animation, emote, color_rgb, movement, memory_update, should_speak, suggested_state. "
                        "movement must include target_anchor, offset_x, offset_y, speed. "
                        "target_anchor must be one of right_shoulder, left_shoulder, active_palm, nose. "
                        "memory_update may include user_name, favorite_color, last_topic, notes. "
                        "Good tone examples: "
                        "'Sip, aku geser ke bahu kanan ya.' "
                        "'Halo Jadi, aku ingat kamu.' "
                        "'Aku bisa mendekat, tapi tracking-mu lagi goyang sedikit.'"
                    ),
                },
                {
                    "role": "user",
                    "content": json.dumps(
                        {
                            "persona": self.config.persona,
                            "context": {
                                "state": context.state,
                                "mood": context.mood,
                                "bond": context.bond,
                                "energy": context.energy,
                                "interaction_count": context.interaction_count,
                                "last_event": context.last_event,
                                "memory_summary": context.memory_summary,
                                "known_user_name": context.known_user_name,
                                "tracking_confidence": context.tracking_confidence,
                            },
                            "event": event.name if event else None,
                            "utterance": user_utterance,
                        }
                    ),
                },
            ],
        }
        raw = self._chat_completion(payload)
        content = raw["choices"][0]["message"]["content"]
        data = json.loads(content)
        return self._parse_plan(data=data, fallback_context=context)

    def _chat_completion(self, payload: dict) -> dict:
        if shutil.which("curl"):
            return self._chat_completion_with_curl(payload)
        return self._chat_completion_with_urllib(payload)

    def _chat_completion_with_curl(self, payload: dict) -> dict:
        command = [
            "curl",
            "-sS",
            "--max-time",
            str(int(self.config.timeout_s)),
            "-H",
            f"Authorization: Bearer {self.config.api_key}",
            "-H",
            "Content-Type: application/json",
            f"{self.config.api_base.rstrip('/')}/chat/completions",
            "-d",
            json.dumps(payload),
        ]
        completed = subprocess.run(command, check=True, capture_output=True, text=True, timeout=self.config.timeout_s + 1)
        return json.loads(completed.stdout)

    def _chat_completion_with_urllib(self, payload: dict) -> dict:
        body = json.dumps(payload).encode("utf-8")
        req = urllib.request.Request(
            f"{self.config.api_base.rstrip('/')}/chat/completions",
            data=body,
            headers={
                "Authorization": f"Bearer {self.config.api_key}",
                "Content-Type": "application/json",
            },
            method="POST",
        )
        with urllib.request.urlopen(req, timeout=self.config.timeout_s) as resp:
            return json.loads(resp.read().decode("utf-8"))

    @staticmethod
    def _parse_plan(data: dict, fallback_context: PetContext) -> AgentActionPlan:
        color_values = data.get("color_rgb", [140, 240, 255])
        color = tuple(int(x) for x in color_values[:3])
        movement_data = data.get("movement", {})
        movement = MovementCommand(
            target_anchor=str(movement_data.get("target_anchor", "right_shoulder")),
            offset_x=int(movement_data.get("offset_x", 0)),
            offset_y=int(movement_data.get("offset_y", 0)),
            speed=float(movement_data.get("speed", 1.0)),
        )
        if movement.target_anchor not in {"right_shoulder", "left_shoulder", "active_palm", "nose"}:
            movement.target_anchor = "right_shoulder"
        memory_data = data.get("memory_update", {})
        memory = MemoryUpdate(
            user_name=memory_data.get("user_name"),
            favorite_color=memory_data.get("favorite_color"),
            last_topic=memory_data.get("last_topic"),
            notes=[str(item) for item in memory_data.get("notes", [])],
        )
        return AgentActionPlan(
            reply=str(data.get("reply", "Aku di sini.")),
            emotion=str(data.get("emotion", fallback_context.mood)),
            animation=str(data.get("animation", "hover")),
            emote=str(data.get("emote", "idle")),
            color_rgb=(color[0], color[1], color[2]),
            movement=movement,
            memory_update=memory,
            should_speak=bool(data.get("should_speak", True)),
            suggested_state=str(data.get("suggested_state") or fallback_context.state),
            response_source="remote",
        )
