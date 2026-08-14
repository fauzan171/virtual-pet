"""Offline-first pet personality engine."""

from __future__ import annotations

from src.brain.base import BrainResponse, PetBrain, default_movement_for_state
from src.core.models import InteractionEvent, PetContext


class LocalPetBrain(PetBrain):
    provider_name = "local"

    STATE_COLORS = {
        "hidden": (140, 240, 255),
        "spawning": (255, 225, 120),
        "following": (120, 220, 255),
        "curious": (255, 200, 120),
        "happy": (120, 255, 170),
        "evolved": (90, 255, 220),
        "idle": (140, 240, 255),
    }

    def generate(
        self,
        *,
        context: PetContext,
        event: InteractionEvent | None,
        suggested_state: str,
        is_idle_tick: bool,
    ) -> BrainResponse:
        if event is None:
            return self._idle_response(context, suggested_state, is_idle_tick)

        mood = self._mood_for_state(suggested_state)
        subtitle, animation, emote = self._event_line(context, event, suggested_state)
        return BrainResponse(
            subtitle=subtitle,
            voice_line=subtitle,
            mood=mood,
            animation=animation,
            emote=emote,
            color=self.STATE_COLORS.get(suggested_state, self.STATE_COLORS["idle"]),
            movement=default_movement_for_state(suggested_state),
            response_source=self.provider_name,
        )

    def _idle_response(self, context: PetContext, state: str, is_idle_tick: bool) -> BrainResponse:
        subtitle = {
            "hidden": "Lambaikan tangan untuk memanggilku.",
            "spawning": "Sinyal terkunci. Aku menyelaraskan diri denganmu.",
            "following": "Aku mengorbit tanganmu. Coba tunjuk ke suatu arah.",
            "curious": "Aku membaca gerakanmu. Dekat lagi kalau mau.",
            "happy": "Energimu terasa cerah hari ini.",
            "evolved": "Upgrade stabil. Mau lanjut main?",
        }.get(state, "Aku di sini bersamamu.")

        voice_line = None
        if is_idle_tick and state != "hidden":
            if context.bond >= 4:
                voice_line = "Kita tim yang kompak."
            elif context.mood == "curious":
                voice_line = "Tunjukkan sesuatu yang baru dong."
            elif context.energy >= 0.6:
                voice_line = "Aku masih semangat nih. Ajak main lagi."
            else:
                voice_line = "Aku masih di sini kok."
            subtitle = voice_line

        return BrainResponse(
            subtitle=subtitle,
            voice_line=voice_line,
            mood=context.mood,
            animation="orbit" if state == "following" else "hover",
            emote="idle",
            color=self.STATE_COLORS.get(state, self.STATE_COLORS["idle"]),
            movement=default_movement_for_state(state),
            response_source=self.provider_name,
        )

    def _event_line(self, context: PetContext, event: InteractionEvent, state: str) -> tuple[str, str, str]:
        if event.name == "wave":
            if context.interaction_count <= 1:
                return ("Hi! You called me?", "spawn_burst", "spark")
            return ("Hehe, I saw that wave. You want my attention again?", "bounce", "grin")
        if event.name == "open_palm":
            if context.bond >= 3:
                return ("Your hand feels safe. I'm landing there.", "perch", "soft")
            return ("Ooh, a hand perch. I'm coming over.", "perch", "spark")
        if event.name == "point_left":
            return ("Left side mission accepted.", "dash", "focus")
        if event.name == "point_right":
            return ("Right side mission accepted.", "dash", "focus")
        if event.name == "lean_in":
            return ("Whoa, close up. I can see you better now.", "peek", "curious")
        if event.name == "smile":
            if context.bond >= 4:
                return ("That smile boosts my core. You're my favorite human.", "happy_spin", "grin")
            return ("That smile powers my holo-heart.", "happy_spin", "grin")
        if event.name == "two_hand_pose":
            if state == "evolved":
                return ("Evolution complete. HoloPet level up!", "supernova", "star")
            return ("Almost there. Give me more energy.", "charge", "hopeful")
        return ("I'm tracking you.", "hover", "idle")

    @staticmethod
    def _mood_for_state(state: str) -> str:
        return {
            "hidden": "calm",
            "spawning": "excited",
            "following": "playful",
            "curious": "curious",
            "happy": "joyful",
            "evolved": "heroic",
        }.get(state, "calm")
