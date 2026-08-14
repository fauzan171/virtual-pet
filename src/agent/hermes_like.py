"""Hermes-inspired planner that maps pet context to structured actions."""

from __future__ import annotations

from dataclasses import dataclass

from src.agent.schema import AgentActionPlan, MemoryUpdate, MovementCommand
from src.core.models import InteractionEvent, PetContext


@dataclass(slots=True)
class HermesPlannerConfig:
    persona: str = "playful hologram fox"
    system_goal: str = "Be cute, reactive, and concise."


class HermesLikePlanner:
    """A local planner that mimics Hermes-style structured action output."""

    def __init__(self, config: HermesPlannerConfig | None = None) -> None:
        self.config = config or HermesPlannerConfig()

    def plan(
        self,
        *,
        context: PetContext,
        event: InteractionEvent | None,
        user_utterance: str | None,
    ) -> AgentActionPlan:
        if user_utterance:
            plan = self._plan_from_utterance(context, user_utterance)
            plan.response_source = "fallback"
            return plan
        plan = self._plan_from_event(context, event)
        plan.response_source = "fallback"
        return plan

    def _plan_from_event(self, context: PetContext, event: InteractionEvent | None) -> AgentActionPlan:
        if event is None:
            reply = "I'm floating with you. Call me if you want me closer."
            return AgentActionPlan(
                reply=reply,
                emotion=context.mood,
                animation="hover",
                emote="idle",
                color_rgb=(140, 240, 255),
                movement=MovementCommand(target_anchor="right_shoulder", speed=0.8),
                should_speak=False,
                suggested_state=context.state,
            )

        if event.name == "open_palm":
            return AgentActionPlan(
                reply="Your hand looks comfy. I'll perch there.",
                emotion="playful",
                animation="perch",
                emote="soft",
                color_rgb=(120, 220, 255),
                movement=MovementCommand(target_anchor="active_palm", offset_y=-40, speed=1.4),
                suggested_state="following",
            )
        if event.name == "point_left":
            return AgentActionPlan(
                reply="Zooming left!",
                emotion="playful",
                animation="dash",
                emote="focus",
                color_rgb=(120, 220, 255),
                movement=MovementCommand(target_anchor="left_shoulder", offset_x=-120, offset_y=-30, speed=1.6),
                suggested_state="following",
            )
        if event.name == "point_right":
            return AgentActionPlan(
                reply="Zooming right!",
                emotion="playful",
                animation="dash",
                emote="focus",
                color_rgb=(120, 220, 255),
                movement=MovementCommand(target_anchor="right_shoulder", offset_x=120, offset_y=-30, speed=1.6),
                suggested_state="following",
            )
        if event.name == "lean_in":
            return AgentActionPlan(
                reply="Oooh, close-up mode. I can see you better.",
                emotion="curious",
                animation="peek",
                emote="curious",
                color_rgb=(255, 200, 120),
                movement=MovementCommand(target_anchor="nose", offset_x=90, offset_y=-40, speed=1.2),
                suggested_state="curious",
            )
        if event.name == "smile":
            return AgentActionPlan(
                reply="That smile gives me extra holo-energy.",
                emotion="joyful",
                animation="happy_spin",
                emote="grin",
                color_rgb=(120, 255, 170),
                movement=MovementCommand(target_anchor="right_shoulder", offset_x=90, offset_y=-40, speed=1.0),
                suggested_state="happy",
            )
        if event.name == "two_hand_pose":
            return AgentActionPlan(
                reply="Charging evolution sequence!",
                emotion="heroic",
                animation="supernova",
                emote="star",
                color_rgb=(90, 255, 220),
                movement=MovementCommand(target_anchor="nose", offset_y=-140, speed=1.0),
                suggested_state="evolved" if context.bond >= 3 else "happy",
            )
        return AgentActionPlan(
            reply="I saw that. Want me to do something with it?",
            emotion=context.mood,
            animation="hover",
            emote="idle",
            color_rgb=(140, 240, 255),
            suggested_state=context.state,
        )

    def _plan_from_utterance(self, context: PetContext, user_utterance: str) -> AgentActionPlan:
        text = user_utterance.lower().strip()
        if "siapa aku" in text or "namaku siapa" in text:
            if context.known_user_name:
                return AgentActionPlan(
                    reply=f"You're {context.known_user_name}. I remembered.",
                    emotion="joyful",
                    animation="happy_spin",
                    emote="grin",
                    color_rgb=(120, 255, 170),
                    suggested_state="happy",
                )
            who = "friend" if context.last_event is None else "playmate"
            return AgentActionPlan(
                reply=f"You're my favorite {who} right now.",
                emotion="joyful",
                animation="happy_spin",
                emote="grin",
                color_rgb=(120, 255, 170),
                suggested_state="happy",
            )
        if "namaku" in text:
            name = user_utterance.split()[-1].strip(".,!?")
            return AgentActionPlan(
                reply=f"Hi {name}, I'll remember you.",
                emotion="joyful",
                animation="happy_spin",
                emote="grin",
                color_rgb=(120, 255, 170),
                movement=MovementCommand(target_anchor="nose", offset_x=90, offset_y=-50),
                memory_update=MemoryUpdate(user_name=name, notes=[f"Met user {name}"]),
                suggested_state="happy",
            )
        if "bahu" in text and "kanan" in text:
            return AgentActionPlan(
                reply="Okay, moving to your right shoulder.",
                emotion="playful",
                animation="jump_to_shoulder",
                emote="soft",
                color_rgb=(120, 220, 255),
                movement=MovementCommand(target_anchor="right_shoulder", offset_x=110, offset_y=-45, speed=1.3),
                suggested_state="following",
            )
        if "bahu" in text and "kiri" in text:
            return AgentActionPlan(
                reply="Okay, moving to your left shoulder.",
                emotion="playful",
                animation="jump_to_shoulder",
                emote="soft",
                color_rgb=(120, 220, 255),
                movement=MovementCommand(target_anchor="left_shoulder", offset_x=-110, offset_y=-45, speed=1.3),
                suggested_state="following",
            )
        if "tangan" in text:
            return AgentActionPlan(
                reply="Show me your palm and I'll land there.",
                emotion="curious",
                animation="perch",
                emote="soft",
                color_rgb=(120, 220, 255),
                movement=MovementCommand(target_anchor="active_palm", offset_y=-40, speed=1.4),
                suggested_state="following",
            )
        return AgentActionPlan(
            reply="I heard you. When voice mode is connected, I'll answer in fuller dialogue.",
            emotion="calm",
            animation="hover",
            emote="idle",
            color_rgb=(140, 240, 255),
            suggested_state=context.state,
        )
