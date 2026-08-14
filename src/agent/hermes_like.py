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
            # Cycle idle lines instead of repeating one forever.
            lines = (
                "Aku nemenin di sini. Panggil kalau mau aku mendekat.",
                "Masih di sini kok. Santai aja.",
                "Kamu gerak dikit, aku langsung nengok.",
                "Energiku stabil. Mau main sesuatu?",
            )
            reply = lines[context.interaction_count % len(lines)]
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
                reply="Tangannya enak. Aku hinggap sini ya.",
                emotion="playful",
                animation="perch",
                emote="soft",
                color_rgb=(120, 220, 255),
                movement=MovementCommand(target_anchor="active_palm", offset_y=-40, speed=1.4),
                suggested_state="following",
            )
        if event.name == "point_left":
            return AgentActionPlan(
                reply="Sip, aku meluncur ke kiri.",
                emotion="playful",
                animation="dash",
                emote="focus",
                color_rgb=(120, 220, 255),
                movement=MovementCommand(target_anchor="left_shoulder", offset_x=-120, offset_y=-30, speed=1.6),
                suggested_state="following",
            )
        if event.name == "point_right":
            return AgentActionPlan(
                reply="Oke, aku geser ke kanan.",
                emotion="playful",
                animation="dash",
                emote="focus",
                color_rgb=(120, 220, 255),
                movement=MovementCommand(target_anchor="right_shoulder", offset_x=120, offset_y=-30, speed=1.6),
                suggested_state="following",
            )
        if event.name == "lean_in":
            return AgentActionPlan(
                reply="Hehe, dekat sekali. Aku bisa lihat lebih jelas.",
                emotion="curious",
                animation="peek",
                emote="curious",
                color_rgb=(255, 200, 120),
                movement=MovementCommand(target_anchor="nose", offset_x=90, offset_y=-40, speed=1.2),
                suggested_state="curious",
            )
        if event.name == "smile":
            return AgentActionPlan(
                reply="Senyummu bikin energiku naik.",
                emotion="joyful",
                animation="happy_spin",
                emote="grin",
                color_rgb=(120, 255, 170),
                movement=MovementCommand(target_anchor="right_shoulder", offset_x=90, offset_y=-40, speed=1.0),
                suggested_state="happy",
            )
        if event.name == "two_hand_pose":
            return AgentActionPlan(
                reply="Wah, aku naik level dulu ya!",
                emotion="heroic",
                animation="supernova",
                emote="star",
                color_rgb=(90, 255, 220),
                movement=MovementCommand(target_anchor="nose", offset_y=-140, speed=1.0),
                suggested_state="evolved" if context.bond >= 3 else "happy",
            )
        return AgentActionPlan(
            reply="Aku lihat kok. Mau aku ngapain?",
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
                    reply=f"Kamu {context.known_user_name}. Aku ingat kok.",
                    emotion="joyful",
                    animation="happy_spin",
                    emote="grin",
                    color_rgb=(120, 255, 170),
                    movement=MovementCommand(target_anchor="nose", offset_x=70, offset_y=-45, speed=1.1),
                    suggested_state="happy",
                )
            who = "friend" if context.last_event is None else "playmate"
            return AgentActionPlan(
                reply=f"Kamu {who} favoritku sekarang.",
                emotion="joyful",
                animation="happy_spin",
                emote="grin",
                color_rgb=(120, 255, 170),
                movement=MovementCommand(target_anchor="nose", offset_x=70, offset_y=-45, speed=1.0),
                suggested_state="happy",
            )
        if "warna favorit" in text and ("aku suka" in text or "favoritku" in text):
            color = user_utterance.split()[-1].strip(".,!?").lower()
            return AgentActionPlan(
                reply=f"Oke, aku simpan. Warna favoritmu {color}.",
                emotion="joyful",
                animation="happy_spin",
                emote="grin",
                color_rgb=(120, 255, 170),
                movement=MovementCommand(target_anchor="active_palm", offset_y=-35, speed=1.2),
                memory_update=MemoryUpdate(favorite_color=color, notes=[f"Favorite color {color}"]),
                suggested_state="happy",
            )
        if "warna favoritku" in text or "warna kesukaanku" in text:
            favorite = self._favorite_color(context.memory_summary)
            reply = f"Warna favoritmu {favorite}." if favorite else "Kamu belum bilang. Bocorin dong."
            return AgentActionPlan(
                reply=reply,
                emotion="curious",
                animation="peek",
                emote="curious",
                color_rgb=(255, 200, 120),
                movement=MovementCommand(target_anchor="nose", offset_x=70, offset_y=-35, speed=1.0),
                memory_update=MemoryUpdate(last_topic="warna favorit"),
                suggested_state="curious",
            )
        if "namaku" in text:
            name = user_utterance.split()[-1].strip(".,!?")
            return AgentActionPlan(
                reply=f"Halo {name}, aku ingat kamu ya.",
                emotion="joyful",
                animation="happy_spin",
                emote="grin",
                color_rgb=(120, 255, 170),
                movement=MovementCommand(target_anchor="nose", offset_x=90, offset_y=-50),
                memory_update=MemoryUpdate(user_name=name, last_topic="nama", notes=[f"Met user {name}"]),
                suggested_state="happy",
            )
        if "bahu" in text and "kanan" in text:
            return AgentActionPlan(
                reply=self._with_name("Sip, aku pindah ke bahu kanan.", context),
                emotion="playful",
                animation="jump_to_shoulder",
                emote="soft",
                color_rgb=(120, 220, 255),
                movement=MovementCommand(target_anchor="right_shoulder", offset_x=110, offset_y=-45, speed=1.3),
                memory_update=MemoryUpdate(last_topic="gerak"),
                suggested_state="following",
            )
        if "bahu" in text and "kiri" in text:
            return AgentActionPlan(
                reply=self._with_name("Oke, aku ke bahu kiri ya.", context),
                emotion="playful",
                animation="jump_to_shoulder",
                emote="soft",
                color_rgb=(120, 220, 255),
                movement=MovementCommand(target_anchor="left_shoulder", offset_x=-110, offset_y=-45, speed=1.3),
                memory_update=MemoryUpdate(last_topic="gerak"),
                suggested_state="following",
            )
        if "tangan" in text or "telapak" in text:
            return AgentActionPlan(
                reply=self._with_name("Kasih telapakmu, aku hinggap di sana.", context),
                emotion="curious",
                animation="perch",
                emote="soft",
                color_rgb=(120, 220, 255),
                movement=MovementCommand(target_anchor="active_palm", offset_y=-40, speed=1.4),
                memory_update=MemoryUpdate(last_topic="gerak"),
                suggested_state="following",
            )
        if "dekat" in text or "mendekat" in text or "ke hidung" in text:
            return AgentActionPlan(
                reply=self._with_name("Aku mendekat ya. Jangan kaget, hehe.", context),
                emotion="curious",
                animation="peek",
                emote="curious",
                color_rgb=(255, 200, 120),
                movement=MovementCommand(target_anchor="nose", offset_x=65, offset_y=-40, speed=1.2),
                memory_update=MemoryUpdate(last_topic="gerak"),
                suggested_state="curious",
            )
        if "topik terakhir" in text or "tadi kita" in text or "bahas apa" in text:
            if context.memory_summary and "last_topic=" in context.memory_summary:
                topic = context.memory_summary.split("last_topic=", 1)[1].split(",", 1)[0]
                reply = f"Tadi kita bahas {topic}."
            else:
                reply = "Belum ada topik. Yuk mulai sesuatu."
            return AgentActionPlan(
                reply=reply,
                emotion="curious",
                animation="peek",
                emote="curious",
                color_rgb=(255, 200, 120),
                movement=MovementCommand(target_anchor="nose", offset_x=70, offset_y=-35, speed=1.0),
                suggested_state="curious",
            )
        return AgentActionPlan(
            reply=self._small_talk_reply(context),
            emotion="calm",
            animation="hover",
            emote="idle",
            color_rgb=(140, 240, 255),
            movement=MovementCommand(target_anchor="right_shoulder", offset_x=85, offset_y=-35, speed=0.95),
            memory_update=MemoryUpdate(last_topic=self._topic_from(text)),
            suggested_state=context.state,
        )

    @staticmethod
    def _with_name(reply: str, context: PetContext) -> str:
        if context.known_user_name:
            return f"{reply.rstrip('.!')} ya, {context.known_user_name}."
        return reply

    @staticmethod
    def _favorite_color(memory_summary: str) -> str | None:
        if "favorite_color=" in memory_summary:
            return memory_summary.split("favorite_color=", 1)[1].split(",", 1)[0]
        return None

    @staticmethod
    def _topic_from(text: str) -> str:
        words = [word.strip(".,!?") for word in text.split() if len(word.strip(".,!?")) > 2]
        return " ".join(words[:3]) if words else text[:20]

    def _small_talk_reply(self, context: PetContext) -> str:
        color = self._favorite_color(context.memory_summary)
        if context.known_user_name and color:
            return f"Aku dengar, {context.known_user_name}. Masih suka {color} kan?"
        if context.known_user_name:
            return f"Aku dengar, {context.known_user_name}. Bilang saja mau aku ke mana."
        if color:
            return f"Aku dengar. Eh, {color} masih favoritmu kan?"
        return "Aku dengar. Bilang saja mau aku ke mana."
