"""Structured action schema for the HoloPet agent layer."""

from __future__ import annotations

from dataclasses import dataclass, field

from src.core.models import MovementCommand


@dataclass(slots=True)
class MemoryUpdate:
    user_name: str | None = None
    favorite_color: str | None = None
    last_topic: str | None = None
    notes: list[str] = field(default_factory=list)


@dataclass(slots=True)
class AgentActionPlan:
    reply: str
    emotion: str
    animation: str
    emote: str
    color_rgb: tuple[int, int, int]
    movement: MovementCommand = field(default_factory=MovementCommand)
    memory_update: MemoryUpdate = field(default_factory=MemoryUpdate)
    should_speak: bool = True
    suggested_state: str | None = None
    response_source: str = "local"
