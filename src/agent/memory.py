"""Lightweight persistent-style memory primitives for HoloPet."""

from __future__ import annotations

from dataclasses import dataclass, field

from src.agent.schema import MemoryUpdate


@dataclass(slots=True)
class PetMemory:
    user_name: str | None = None
    favorite_color: str | None = None
    last_topic: str | None = None
    notes: list[str] = field(default_factory=list)

    def apply(self, update: MemoryUpdate) -> None:
        if update.user_name:
            self.user_name = update.user_name
        if update.favorite_color:
            self.favorite_color = update.favorite_color
        if update.last_topic:
            self.last_topic = update.last_topic
        if update.notes:
            self.notes.extend(update.notes)

    def summary(self) -> str:
        parts: list[str] = []
        if self.user_name:
            parts.append(f"user_name={self.user_name}")
        if self.favorite_color:
            parts.append(f"favorite_color={self.favorite_color}")
        if self.last_topic:
            parts.append(f"last_topic={self.last_topic}")
        if self.notes:
            parts.append(f"notes={len(self.notes)}")
        return ", ".join(parts) if parts else "empty"
