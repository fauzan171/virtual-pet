"""Shared domain models for the HoloPet runtime."""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Optional


Point = tuple[int, int]
BodyBounds = tuple[int, int, int, int]

# One movement vocabulary is shared by tracking, planners, and rendering.  Raw
# MediaPipe names stay implementation details of the CV adapter; callers only
# need these stable HoloPet anchor names.
POSE_ANCHOR_NAMES: tuple[str, ...] = (
    "nose",
    "left_ear",
    "right_ear",
    "left_shoulder",
    "right_shoulder",
    "left_elbow",
    "right_elbow",
    "left_wrist",
    "right_wrist",
    "left_hip",
    "right_hip",
    "left_knee",
    "right_knee",
    "left_ankle",
    "right_ankle",
    "left_heel",
    "right_heel",
    "left_foot",
    "right_foot",
)
DERIVED_BODY_ANCHOR_NAMES: tuple[str, ...] = (
    "head_top",
    "chest",
    "hip_center",
    "body_center",
)
MOVEMENT_ANCHOR_NAMES: tuple[str, ...] = (
    *POSE_ANCHOR_NAMES,
    *DERIVED_BODY_ANCHOR_NAMES,
    "active_palm",
    "pointing_target",
)
SUPPORTED_MOVEMENT_ANCHORS = frozenset(MOVEMENT_ANCHOR_NAMES)


_ANATOMICAL_FALLBACKS: dict[str, tuple[str, ...]] = {
    "head_top": ("nose", "chest", "right_shoulder", "left_shoulder"),
    "nose": ("head_top", "chest", "right_shoulder", "left_shoulder"),
    "chest": ("right_shoulder", "left_shoulder", "hip_center", "body_center"),
    "body_center": ("chest", "hip_center", "right_hip", "left_hip"),
    "hip_center": ("right_hip", "left_hip", "body_center", "chest"),
    "active_palm": ("right_wrist", "left_wrist", "right_elbow", "left_elbow"),
    "pointing_target": ("active_palm", "right_wrist", "left_wrist"),
    "left_ear": ("nose", "head_top", "left_shoulder"),
    "right_ear": ("nose", "head_top", "right_shoulder"),
    "left_shoulder": ("chest", "left_elbow", "right_shoulder"),
    "right_shoulder": ("chest", "right_elbow", "left_shoulder"),
    "left_elbow": ("left_shoulder", "left_wrist", "chest"),
    "right_elbow": ("right_shoulder", "right_wrist", "chest"),
    "left_wrist": ("active_palm", "left_elbow", "left_shoulder"),
    "right_wrist": ("active_palm", "right_elbow", "right_shoulder"),
    "left_hip": ("hip_center", "left_knee", "body_center"),
    "right_hip": ("hip_center", "right_knee", "body_center"),
    "left_knee": ("left_hip", "left_ankle", "hip_center"),
    "right_knee": ("right_hip", "right_ankle", "hip_center"),
    "left_ankle": ("left_foot", "left_knee", "left_hip"),
    "right_ankle": ("right_foot", "right_knee", "right_hip"),
    "left_heel": ("left_ankle", "left_foot", "left_knee"),
    "right_heel": ("right_ankle", "right_foot", "right_knee"),
    "left_foot": ("left_ankle", "left_heel", "left_knee", "left_hip"),
    "right_foot": ("right_ankle", "right_heel", "right_knee", "right_hip"),
}


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
    """Desired pet placement relative to a tracked body anchor.

    Offsets are design pixels calibrated for a 230px shoulder width.  The
    motion module scales them to the visible person, so the same command feels
    identical at different camera resolutions and distances.
    """

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
    nose: Optional[Point] = None
    left_shoulder: Optional[Point] = None
    right_shoulder: Optional[Point] = None
    left_wrist: Optional[Point] = None
    right_wrist: Optional[Point] = None
    left_elbow: Optional[Point] = None
    right_elbow: Optional[Point] = None
    left_hip: Optional[Point] = None
    right_hip: Optional[Point] = None
    left_knee: Optional[Point] = None
    right_knee: Optional[Point] = None
    active_palm: Optional[Point] = None
    active_hand: Optional[str] = None
    pointing_target: Optional[Point] = None
    pose_anchors: dict[str, Point] = field(default_factory=dict)
    anchor_confidence: dict[str, float] = field(default_factory=dict)
    body_bounds: Optional[BodyBounds] = None
    body_scale_px: float = 230.0
    full_body_visible: bool = False
    captured_at: float = 0.0
    smile_score: float = 0.0
    tracking_confidence: float = 0.0
    fired_event: Optional[InteractionEvent] = None
    debug: dict[str, float | str] = field(default_factory=dict)

    def anchor(self, name: str, *, min_confidence: float = 0.0) -> Optional[Point]:
        """Return one direct anchor without inventing a cross-body fallback."""

        point = self.pose_anchors.get(name)
        if point is None and name in {"active_palm", "pointing_target"}:
            point = getattr(self, name)
        if point is None and name in POSE_ANCHOR_NAMES:
            # Compatibility with snapshots constructed by older callers/tests.
            point = getattr(self, name, None)
        confidence = self.anchor_confidence.get(name, 1.0 if point is not None else 0.0)
        return point if point is not None and confidence >= min_confidence else None

    def resolve_anchor(self, name: str, *, min_confidence: float = 0.25) -> Optional[Point]:
        """Resolve a target through same-area anatomical fallbacks.

        A missing left knee falls back along the left leg/hip chain, never to a
        hand on the opposite side.  This keeps short tracking dropouts from
        turning into visible teleports.
        """

        direct = self.anchor(name, min_confidence=min_confidence)
        if direct is not None:
            return direct
        fallback_names = _ANATOMICAL_FALLBACKS.get(name, ())
        if name in {"active_palm", "pointing_target"} and self.active_hand in {"left", "right"}:
            side = self.active_hand
            prefix = ("active_palm",) if name == "pointing_target" else ()
            fallback_names = (
                *prefix,
                f"{side}_wrist",
                f"{side}_elbow",
            )
        for fallback_name in fallback_names:
            fallback = self.anchor(fallback_name, min_confidence=min_confidence)
            if fallback is not None:
                return fallback
        return None
