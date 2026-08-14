"""Abstract interfaces for pet response generation."""

from __future__ import annotations

from dataclasses import dataclass, field

from src.core.models import InteractionEvent, MovementCommand, PetContext


@dataclass(slots=True)
class BrainResponse:
    subtitle: str
    voice_line: str | None
    mood: str
    animation: str
    emote: str
    color: tuple[int, int, int]
    movement: MovementCommand = field(default_factory=MovementCommand)
    response_source: str = "local"


class PetBrain:
    provider_name = "base"

    def generate(
        self,
        *,
        context: PetContext,
        event: InteractionEvent | None,
        suggested_state: str,
        is_idle_tick: bool,
    ) -> BrainResponse:
        raise NotImplementedError

    def build_dialog_loop(self, *, tts=None, stt=None, listener=None):
        # ponytail: every brain gets a local fallback planner for chat so text/
        # voice dialogue works even without a remote brain. Bridges override this.
        from src.agent.coordinator import AgentCoordinator
        from src.agent.dialog_loop import DialogueLoop
        from src.agent.hermes_like import HermesLikePlanner

        return DialogueLoop(
            coordinator=AgentCoordinator(planner=HermesLikePlanner()),
            tts=tts,
            stt=stt,
            listener=listener,
        )


# Whole-body roam targets: shoulders, arms, lap and head. The renderer falls
# back when a landmark is off-camera, so any subset works.
WANDER_ANCHORS = (
    ("right_shoulder", 110, -40),
    ("left_shoulder", -110, -40),
    ("right_elbow", 90, -30),
    ("left_elbow", -90, -30),
    ("right_hip", 90, -30),
    ("left_hip", -90, -30),
    ("nose", 0, -120),
)


def wander_movement(step: int) -> MovementCommand:
    anchor, offset_x, offset_y = WANDER_ANCHORS[step % len(WANDER_ANCHORS)]
    return MovementCommand(target_anchor=anchor, offset_x=offset_x, offset_y=offset_y, speed=0.9)


def default_movement_for_state(suggested_state: str) -> MovementCommand:
    if suggested_state == "following":
        return MovementCommand(target_anchor="active_palm", offset_y=-40, speed=1.2)
    if suggested_state == "curious":
        return MovementCommand(target_anchor="nose", offset_x=90, offset_y=-50, speed=1.1)
    if suggested_state == "evolved":
        return MovementCommand(target_anchor="nose", offset_y=-140, speed=0.9)
    return MovementCommand(target_anchor="right_shoulder", offset_x=110, offset_y=-30, speed=1.0)
