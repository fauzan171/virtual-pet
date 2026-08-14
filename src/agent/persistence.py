"""JSON-backed persistence for HoloPet agent state."""

from __future__ import annotations

import json
import shutil
from dataclasses import asdict
from pathlib import Path

from src.agent.memory import PetMemory
from src.agent.session import AgentSessionState


class JsonAgentPersistence:
    """Persists session state locally so the pet remembers the user between runs."""

    def __init__(self, path: str | Path) -> None:
        self.path = Path(path)

    def load_session(self) -> AgentSessionState:
        if not self.path.exists():
            return AgentSessionState(memory=PetMemory())
        data = json.loads(self.path.read_text(encoding="utf-8"))
        memory_data = data.get("memory", {})
        return AgentSessionState(
            memory=PetMemory(
                user_name=memory_data.get("user_name"),
                favorite_color=memory_data.get("favorite_color"),
                last_topic=memory_data.get("last_topic"),
                notes=list(memory_data.get("notes", [])),
            ),
            turn_count=int(data.get("turn_count", 0)),
            last_user_utterance=data.get("last_user_utterance"),
            last_agent_reply=data.get("last_agent_reply"),
            listening=bool(data.get("listening", False)),
        )

    def save_session(self, session: AgentSessionState) -> None:
        self.path.parent.mkdir(parents=True, exist_ok=True)
        if self.path.exists():
            shutil.copy2(self.path, self.backup_path)
        payload = asdict(session)
        payload["version"] = 1
        self.path.write_text(json.dumps(payload, indent=2, sort_keys=True), encoding="utf-8")

    @property
    def backup_path(self) -> Path:
        return self.path.with_suffix(f"{self.path.suffix}.bak")
