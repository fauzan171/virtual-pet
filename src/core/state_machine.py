"""Pet behavior state machine for HoloPet."""

from __future__ import annotations

import time
from dataclasses import dataclass

from src.agent.schema import AgentActionPlan
from src.brain.base import PetBrain
from src.brain.local_brain import LocalPetBrain
from src.core.models import InteractionEvent, PetContext, PetExpression


@dataclass(slots=True)
class CooldownGate:
    duration_ms: int
    last_fired_at: float = 0.0

    def ready(self, now: float) -> bool:
        return (now - self.last_fired_at) * 1000 >= self.duration_ms

    def mark(self, now: float) -> None:
        self.last_fired_at = now


class HoloPetStateMachine:
    """State engine that tracks mood, bond, and AI-driven pet responses."""

    def __init__(self, cooldowns: dict[str, int], brain: PetBrain | None = None) -> None:
        self.state = "hidden"
        self.mood = "calm"
        self.bond = 0
        self.energy = 0.35
        self.interaction_count = 0
        self.last_event_name: str | None = None
        self.last_expression = PetExpression(
            state="hidden",
            subtitle="Lambaikan tangan untuk memanggilku.",
            color=(140, 240, 255),
            voice_line=None,
            mood="calm",
            animation="hover",
            bond_level=0,
            energy=0.35,
            emote="idle",
            response_source="local",
        )
        self.brain = brain or LocalPetBrain()
        self.cooldowns = {
            "greeting": CooldownGate(cooldowns.get("greeting_ms", 2500)),
            "follow": CooldownGate(cooldowns.get("follow_ms", 600)),
            "voice": CooldownGate(cooldowns.get("voice_line_ms", 2000)),
            "evolve": CooldownGate(cooldowns.get("evolve_ms", 6000)),
            "idle": CooldownGate(cooldowns.get("idle_chatter_ms", 4500)),
        }

    def process(
        self,
        event: InteractionEvent | None,
        now: float | None = None,
        *,
        tracking_confidence: float = 1.0,
    ) -> PetExpression:
        now = now if now is not None else time.monotonic()
        is_idle_tick = event is None and self.state != "hidden" and self.cooldowns["idle"].ready(now)

        if event is not None:
            self.interaction_count += 1
            self.last_event_name = event.name
            suggested_state = self._apply_event_transition(event, now)
        else:
            suggested_state = self.state

        response = self.brain.generate(
            context=self._context(tracking_confidence=tracking_confidence),
            event=event,
            suggested_state=suggested_state,
            is_idle_tick=is_idle_tick,
        )
        if is_idle_tick:
            self.cooldowns["idle"].mark(now)
        expression = self._build_expression(response, suggested_state, now, is_idle_tick=is_idle_tick)
        self.last_expression = expression
        return expression

    def _context(self, *, tracking_confidence: float) -> PetContext:
        return PetContext(
            state=self.state,
            mood=self.mood,
            bond=self.bond,
            energy=self.energy,
            interaction_count=self.interaction_count,
            last_event=self.last_event_name,
            memory_summary="empty",
            tracking_confidence=tracking_confidence,
        )

    def _apply_event_transition(self, event: InteractionEvent, now: float) -> str:
        if event.name == "wave":
            if self.state == "hidden" and self.cooldowns["greeting"].ready(now):
                self.state = "spawning"
                self.cooldowns["greeting"].mark(now)
                self._gain_bond(1)
                self._raise_energy(0.12)
                return self.state
            self.state = "happy"
            self._gain_bond(1)
            self._raise_energy(0.06)
            return self.state

        if event.name == "open_palm":
            self.state = "following"
            self._gain_bond(1)
            self._raise_energy(0.04)
            return self.state

        if event.name in {"point_left", "point_right"}:
            self.state = "following"
            self._gain_bond(1)
            self._raise_energy(0.03)
            return self.state

        if event.name == "lean_in":
            self.state = "curious"
            self._raise_energy(0.02)
            return self.state

        if event.name == "smile":
            self.state = "happy"
            self._gain_bond(1)
            self._raise_energy(0.08)
            return self.state

        if event.name == "two_hand_pose":
            if self.bond < 3 or not self.cooldowns["evolve"].ready(now):
                self.state = "happy"
                self._raise_energy(0.04)
                return self.state
            self.state = "evolved"
            self.cooldowns["evolve"].mark(now)
            self._gain_bond(1)
            self._raise_energy(0.18)
            return self.state

        return self.state

    def _build_expression(self, response, state: str, now: float, *, is_idle_tick: bool) -> PetExpression:
        self.mood = response.mood
        voice_line = response.voice_line if (is_idle_tick or self.last_event_name is not None) else None
        if voice_line and not self.cooldowns["voice"].ready(now):
            voice_line = None
        if voice_line:
            self.cooldowns["voice"].mark(now)
        if self.state == "hidden":
            self.energy = max(0.20, self.energy - 0.002)
        elif is_idle_tick:
            self.energy = max(0.28, self.energy - 0.015)
        return PetExpression(
            state=state,
            subtitle=response.subtitle,
            color=response.color,
            voice_line=voice_line,
            mood=response.mood,
            animation=response.animation,
            bond_level=self.bond,
            energy=self.energy,
            emote=response.emote,
            movement=response.movement,
            response_source=response.response_source,
        )

    def apply_dialog_plan(self, plan: AgentActionPlan, now: float | None = None) -> PetExpression:
        now = now if now is not None else time.monotonic()
        next_state = plan.suggested_state or self.state
        self.state = next_state
        self.mood = plan.emotion
        self.last_event_name = "dialogue"
        voice_line = plan.reply if plan.should_speak and self.cooldowns["voice"].ready(now) else None
        if voice_line:
            self.cooldowns["voice"].mark(now)
        expression = PetExpression(
            state=next_state,
            subtitle=plan.reply,
            color=plan.color_rgb,
            voice_line=voice_line,
            mood=plan.emotion,
            animation=plan.animation,
            bond_level=self.bond,
            energy=self.energy,
            emote=plan.emote,
            movement=plan.movement,
            response_source=plan.response_source,
        )
        self.last_expression = expression
        return expression

    def _gain_bond(self, points: int) -> None:
        self.bond = min(5, self.bond + points)

    def _raise_energy(self, amount: float) -> None:
        self.energy = min(1.0, self.energy + amount)
