"""Coordinator that connects perception, memory, and structured planning."""

from __future__ import annotations

from dataclasses import replace

from src.agent.hermes_like import HermesLikePlanner
from src.agent.memory import PetMemory
from src.agent.persistence import JsonAgentPersistence
from src.agent.schema import AgentActionPlan
from src.agent.session import AgentSessionState
from src.core.models import InteractionEvent, PetContext


class AgentCoordinator:
    def __init__(
        self,
        planner: object | None = None,
        memory: PetMemory | None = None,
        persistence: JsonAgentPersistence | None = None,
    ) -> None:
        self.planner = planner or HermesLikePlanner()
        self.persistence = persistence
        self.session = persistence.load_session() if persistence else AgentSessionState(memory=memory or PetMemory())
        if memory is not None and persistence is None:
            self.session.memory = memory

    def handle(
        self,
        *,
        context: PetContext,
        event: InteractionEvent | None,
        user_utterance: str | None = None,
    ) -> AgentActionPlan:
        self.session.start_turn(user_utterance)
        planning_context = replace(
            context,
            memory_summary=self.session.memory.summary(),
            known_user_name=self.session.memory.user_name,
        )
        plan = self.planner.plan(context=planning_context, event=event, user_utterance=user_utterance)
        self.session.memory.apply(plan.memory_update)
        self.session.last_agent_reply = plan.reply
        if self.persistence is not None:
            self.persistence.save_session(self.session)
        return plan
