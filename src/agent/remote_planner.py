"""Remote OpenAI-compatible planner for HoloPet dialogue and action plans."""

from __future__ import annotations

import json
import math
import os
from pathlib import Path
import queue
import socket
import threading
import time
import urllib.error
import urllib.request
from collections.abc import Callable
from dataclasses import dataclass

from src.agent.hermes_like import HermesLikePlanner, HermesPlannerConfig
from src.agent.schema import AgentActionPlan, MemoryUpdate
from src.core.models import (
    MOVEMENT_ANCHOR_NAMES,
    SUPPORTED_MOVEMENT_ANCHORS,
    InteractionEvent,
    MovementCommand,
    PetContext,
)


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
        # A timed-out urllib call cannot be killed safely from another Python
        # thread. Keep at most one transport alive so a stalled peer cannot
        # create an unbounded collection of abandoned request workers.
        self._request_slot = threading.Lock()

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
            plan = self._request_plan(context=context, event=event, user_utterance=user_utterance)
            # JSON-object mode does not guarantee that optional keys are
            # present or truthful.  Reuse the trusted local intent parser so a
            # remote omission cannot suppress poor-tracking safety feedback.
            if user_utterance:
                local_intent = self.fallback.plan(
                    context=context,
                    event=event,
                    user_utterance=user_utterance,
                )
                # This flag describes what the user asked, not what the model
                # chose to animate.  Reconcile both false negatives and false
                # positives against the deterministic local parser.
                plan.movement_requested = local_intent.movement_requested
            return plan
        except (
            urllib.error.URLError,
            TimeoutError,
            socket.timeout,
            OSError,
            ValueError,
            KeyError,
            IndexError,
            TypeError,
            AttributeError,
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
                        "reply, emotion, animation, emote, color_rgb, movement, memory_update, should_speak, movement_requested, suggested_state. "
                        "movement must include target_anchor, offset_x, offset_y, speed. "
                        "target_anchor must be one of: "
                        f"{', '.join(MOVEMENT_ANCHOR_NAMES)}. "
                        "movement_requested must be true only when the user explicitly asks you to move. "
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
        # Keep API keys and prompt/memory content out of process argv.  urllib
        # sends both in request headers/body without exposing them to `ps`.
        # urllib's timeout is an inactivity timeout, so a peer that drips bytes
        # can otherwise keep a read alive forever. A daemon worker plus a
        # monotonic caller-side deadline makes the planner return on time even
        # when the underlying socket does not cooperate.
        timeout_s = float(self.config.timeout_s)
        if not math.isfinite(timeout_s) or timeout_s <= 0.0:
            raise ValueError("remote timeout_s must be a positive finite number")
        if not self._request_slot.acquire(blocking=False):
            raise TimeoutError("previous remote request is still stopping")

        deadline = time.monotonic() + timeout_s
        outcome: queue.Queue[tuple[bool, object]] = queue.Queue(maxsize=1)
        cancel_requested = threading.Event()
        response_lock = threading.Lock()
        active_response: list[object] = []

        def close_response_in_background(resp: object) -> None:
            close = getattr(resp, "close", None)
            if not callable(close):
                return

            def close_worker() -> None:
                try:
                    close()
                except Exception:
                    pass

            threading.Thread(
                target=close_worker,
                name="holopet-remote-close",
                daemon=True,
            ).start()

        def register_response(resp: object) -> None:
            with response_lock:
                should_abort = cancel_requested.is_set()
                if not should_abort:
                    active_response[:] = [resp]
            if should_abort:
                close_response_in_background(resp)

        def unregister_response(resp: object) -> None:
            with response_lock:
                if active_response and active_response[0] is resp:
                    active_response.clear()

        def cancel_transport() -> None:
            cancel_requested.set()
            with response_lock:
                resp = active_response.pop() if active_response else None
            if resp is not None:
                # close() is normally quick and wakes a blocked read, but keep
                # it off the deadline-sensitive caller thread just in case.
                close_response_in_background(resp)

        def request_worker() -> None:
            try:
                try:
                    value: object = self._chat_completion_with_urllib(
                        payload,
                        deadline=deadline,
                        cancel_event=cancel_requested,
                        register_response=register_response,
                        unregister_response=unregister_response,
                    )
                    result = (True, value)
                except Exception as exc:  # relay the transport error to plan()
                    result = (False, exc)
                outcome.put_nowait(result)
            finally:
                self._request_slot.release()

        worker = threading.Thread(
            target=request_worker,
            name="holopet-remote-request",
            daemon=True,
        )
        try:
            worker.start()
        except BaseException:
            self._request_slot.release()
            raise

        remaining_s = deadline - time.monotonic()
        if remaining_s <= 0.0:
            cancel_transport()
            raise TimeoutError("remote request exceeded its total deadline")
        try:
            succeeded, value = outcome.get(timeout=remaining_s)
        except queue.Empty as exc:
            cancel_transport()
            raise TimeoutError("remote request exceeded its total deadline") from exc

        if succeeded:
            if not isinstance(value, dict):
                raise TypeError("remote response must be a JSON object")
            return value
        if isinstance(value, BaseException):
            raise value
        raise RuntimeError("remote request failed without an exception")

    def _chat_completion_with_urllib(
        self,
        payload: dict,
        *,
        deadline: float,
        cancel_event: threading.Event,
        register_response: Callable[[object], None],
        unregister_response: Callable[[object], None],
    ) -> dict:
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
        remaining_s = deadline - time.monotonic()
        if remaining_s <= 0.0:
            raise TimeoutError("remote request exceeded its total deadline")
        with urllib.request.urlopen(req, timeout=remaining_s) as resp:
            register_response(resp)
            try:
                if cancel_event.is_set():
                    raise TimeoutError("remote request exceeded its total deadline")
                raw_body = self._read_response_body(
                    resp,
                    deadline=deadline,
                    cancel_event=cancel_event,
                )
                return json.loads(raw_body.decode("utf-8"))
            finally:
                unregister_response(resp)

    @staticmethod
    def _read_response_body(
        resp: object,
        *,
        deadline: float,
        cancel_event: threading.Event,
    ) -> bytes:
        """Read incrementally when supported so byte-drip responses self-stop."""

        read1 = getattr(resp, "read1", None)
        if not callable(read1):
            # The outer worker deadline still protects the caller for simple
            # response doubles and unusual urllib-compatible transports.
            return resp.read()  # type: ignore[attr-defined, no-any-return]

        chunks: list[bytes] = []
        while True:
            if cancel_event.is_set() or time.monotonic() >= deadline:
                raise TimeoutError("remote response body exceeded its total deadline")
            chunk = read1(64 * 1024)
            if not chunk:
                return b"".join(chunks)
            chunks.append(chunk)

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
        if movement.target_anchor not in SUPPORTED_MOVEMENT_ANCHORS:
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
            movement_requested=bool(data.get("movement_requested", memory.last_topic == "gerak")),
            suggested_state=str(data.get("suggested_state") or fallback_context.state),
            response_source="remote",
        )
