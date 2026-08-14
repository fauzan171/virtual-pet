"""Shared domain models for the HoloPet runtime."""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Optional


@dataclass(slots=True)
class InteractionEvent:
    """Represents a high-level interpreted user action."""

    name: str
    confidence: float = 1.0
    metadata: dict[str, Any] = field(default_factory=dict)


@dataclass(slots=True)
class PetContext:
    """Mutable conversational context for the pet brain."""

    state: str
    mood: str
    bond: int
    energy: float
    interaction_count: int
    last_event: Optional[str] = None
    memory_summary: str = "empty"
    known_user_name: Optional[str] = None
    tracking_confidence: float = 1.0


@dataclass(slots=True)
class MovementCommand:
    """Desired pet placement relative to the current tracking anchors."""

    target_anchor: str = "right_shoulder"
    offset_x: int = 0
    offset_y: int = 0
    speed: float = 1.0


@dataclass(slots=True)
class PetExpression:
    """Text and style payload emitted by the state machine."""

    state: str
    subtitle: str
    color: tuple[int, int, int]
    voice_line: Optional[str] = None
    mood: str = "calm"
    animation: str = "hover"
    bond_level: int = 0
    energy: float = 0.5
    emote: str = "idle"
    movement: MovementCommand = field(default_factory=MovementCommand)
    response_source: str = "local"


@dataclass(slots=True)
class TrackingSnapshot:
    """Signals extracted from the CV pipeline for one frame."""

    frame_size: tuple[int, int]
    nose: Optional[tuple[int, int]] = None
    left_shoulder: Optional[tuple[int, int]] = None
    right_shoulder: Optional[tuple[int, int]] = None
    left_wrist: Optional[tuple[int, int]] = None
    right_wrist: Optional[tuple[int, int]] = None
    left_elbow: Optional[tuple[int, int]] = None
    right_elbow: Optional[tuple[int, int]] = None
    left_hip: Optional[tuple[int, int]] = None
    right_hip: Optional[tuple[int, int]] = None
    left_knee: Optional[tuple[int, int]] = None
    right_knee: Optional[tuple[int, int]] = None
    active_palm: Optional[tuple[int, int]] = None
    pointing_target: Optional[tuple[int, int]] = None
    smile_score: float = 0.0
    tracking_confidence: float = 0.0
    fired_event: Optional[InteractionEvent] = None
    debug: dict[str, float | str] = field(default_factory=dict)
