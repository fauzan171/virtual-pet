# Technical PRD: HoloPet

## 1. Purpose

This document defines the technical plan for building HoloPet as a real-time laptop-camera experience. The goal is to deliver a stable MVP first, then scale behavior, visuals, and interaction depth without changing the core architecture.

## 2. Technical Goals

- Run in real time on a standard laptop with an integrated camera
- Keep the core loop under 150 ms perceived latency
- Maintain stable single-user tracking in indoor light
- Degrade gracefully when tracking confidence drops
- Use a modular architecture so rendering, CV, and audio can evolve independently

## 3. Scope

### In Scope for MVP

- Single-user webcam pipeline
- Pose, face, and hand tracking
- Rule-based gesture recognition
- Pet finite state machine
- 2D hologram rendering
- Local audio playback
- Subtitle display
- Basic debug overlay and calibration controls

### Out of Scope for MVP

- Multi-user support
- Open conversation with LLM dialogue
- Full 3D pet rendering
- Cloud inference
- Long-term memory storage

## 4. System Architecture

```text
Webcam -> Frame Capture -> Landmark Tracking -> Signal Smoothing
      -> Gesture / Expression Inference -> Interaction Engine
      -> Pet State Machine -> Renderer + Audio Engine -> Display Output
```

### Core Modules

#### `src/app`

Application bootstrap, runtime loop, config loading, and window lifecycle.

#### `src/cv`

- camera capture
- frame preprocessing
- landmark extraction
- confidence scoring
- temporal smoothing
- gesture and expression heuristics

#### `src/core`

- domain models
- interaction rules
- pet state machine
- bond meter and progression logic

#### `src/render`

- hologram compositing
- anchor placement
- particles and glow
- subtitle and HUD layers
- debug overlays

#### `src/audio`

- voice line selection
- playback queue
- cooldown logic
- sync with subtitle timing

## 5. CV Pipeline

### Input

- Resolution target: `1280x720` preferred, `960x540` fallback
- Frame rate target: `24-30 FPS`

### Tracking Strategy

Use MediaPipe Holistic for fast prototyping. If performance or stability is uneven, split the pipeline into:

- pose landmarker
- face landmarker
- hand landmarker

### Signals to Extract

- nose, eyes, and head center
- shoulder anchors
- wrist and finger landmarks
- torso tilt
- face distance from camera
- smile proxy if available from face landmarks

### Smoothing

Apply moving-average or exponential smoothing to reduce jitter before gesture classification and anchor placement.

### Confidence Handling

Each module should emit a confidence score. The runtime should:

- hide non-critical effects on low confidence
- freeze the pet briefly instead of snapping
- show a subtle "tracking lost" state when confidence falls below threshold

## 6. Interaction Model

### MVP Gestures

1. `wave`
Purpose: summon or greet the pet

2. `open_palm_hold`
Purpose: invite the pet to approach

3. `point_left` / `point_right`
Purpose: move the pet laterally

4. `lean_in`
Purpose: trigger curiosity reaction

5. `smile`
Purpose: trigger happy reaction

6. `two_hand_pose`
Purpose: activate evolve animation

### Interaction Rules

- Gestures must pass a time threshold before firing
- Repeated triggers need cooldowns
- Conflicting gestures resolve by priority
- High-visibility gestures are preferred over subtle ones for live demos

## 7. Pet Behavior System

### State Graph

`hidden -> spawning -> idle -> following -> curious -> happy -> evolved`

Additional interrupt states:

- `surprised`
- `tracking_lost`
- `cooldown`

### State Responsibilities

- `hidden`: no pet visible
- `spawning`: entry animation and first line
- `idle`: ambient hovering near shoulder or chest anchor
- `following`: pet follows palm or point direction
- `curious`: short investigation motion toward face or gesture source
- `happy`: brighter glow, bounce, affirming voice line
- `evolved`: upgraded appearance and finale sequence
- `tracking_lost`: visual fallback while user reacquires frame

## 8. Rendering Plan

### Style

- 2D hologram sprite with layered glow
- scanline or shimmer effects
- soft cyan or teal palette with optional accent color
- simple HUD and subtitle box

### Anchor Options

- right shoulder for idle mode
- palm center for approach mode
- point ray or screen coordinate for directional motion
- chest center for evolve sequence

### Render Layers

1. camera frame
2. optional background tint / hologram grid
3. pet sprite
4. particles and effects
5. subtitle text
6. debug overlay

## 9. Audio Plan

### MVP Approach

Use pre-recorded voice lines, not live TTS, for stability and tone control.

### Audio Categories

- greeting
- curiosity
- praise
- evolve
- idle chatter
- recovery when tracking is lost

### Playback Rules

- one main voice line at a time
- minimum cooldown between lines
- subtitle must match active line
- important state changes can interrupt idle chatter

## 10. Performance Targets

- total runtime target: `24 FPS` minimum
- ideal runtime target: `30 FPS`
- landmark inference + gesture logic: under `50 ms`
- render + audio orchestration: under `20 ms`
- no hard freeze longer than `250 ms`

## 11. Reliability and Edge Cases

### Known Risks

- poor lighting
- busy background
- hand occlusion
- fast motion blur
- glasses or partial face occlusion
- false positive gestures

### Mitigations

- use large readable gestures
- expose threshold tuning in config
- keep a fallback idle state
- prefer robust shoulder and wrist anchors over tiny finger-only logic when possible
- provide calibration mode before the main experience starts

## 12. Config Strategy

Store thresholds and tuning outside code when possible.

Suggested config groups:

- camera settings
- smoothing weights
- gesture thresholds
- state cooldown durations
- subtitle timings
- anchor offsets

## 13. Testing Strategy

### Unit Tests

- gesture threshold logic
- state transition rules
- config parsing
- subtitle timing queue

### Integration Tests

- camera to landmark pipeline smoke test
- gesture trigger stability over short recorded clips
- state machine to renderer event flow

### Live Demo Tests

- dim indoor room
- bright indoor room
- standing close to camera
- standing one to two meters from camera
- user with glasses
- repeated 10-minute continuous run

## 14. Milestones

### Milestone A: CV Foundation

- webcam capture
- landmark tracking
- debug skeleton and anchor points

### Milestone B: Interaction Core

- gesture classifier
- pet state machine
- event bus or message flow between CV and pet logic

### Milestone C: Experience Layer

- hologram rendering
- subtitle system
- audio playback

### Milestone D: Demo Polish

- evolve sequence
- tuning
- fallback states
- stage rehearsal

## 15. Suggested Starter Files

- `src/app/main.py`
- `src/cv/tracker.py`
- `src/cv/gestures.py`
- `src/core/state_machine.py`
- `src/core/models.py`
- `src/render/renderer.py`
- `src/audio/player.py`
- `configs/interaction.yaml`

## 16. Open Questions

- Which pet style is the final direction: fox, blob, jellyfish, or drone?
- Will the first demo use sprite sheets, layered PNG parts, or vector-style drawing?
- Do we need bilingual subtitles from day one?
- Is smile detection required for MVP or can it wait until phase 2?
- What is the exact target laptop spec for the stage machine?
