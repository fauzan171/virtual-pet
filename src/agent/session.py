"""Session state for Hermes-style planning."""

from __future__ import annotations

from dataclasses import dataclass

from src.agent.memory import PetMemory


@dataclass(slots=True)
class AgentSessionState:
    memory: PetMemory
    turn_count: int = 0
    last_user_utterance: str | None = None
    last_agent_reply: str | None = None
    listening: bool = False

    def start_turn(self, utterance: str | None) -> None:
        self.turn_count += 1
        if utterance:
            self.last_user_utterance = utterance
