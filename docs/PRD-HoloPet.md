# Product Requirements Document: HoloPet

## 1. Summary

HoloPet is a real-time computer vision demo that turns a laptop camera into a playful hologram companion experience. A digital pet appears on screen, reacts to the user through gestures, face movement, and simple expression cues, and speaks with short lines that make the interaction feel alive.

## 2. Contacts

| Name | Role | Comment |
| --- | --- | --- |
| Project Owner | Product Lead | Owns concept, story, and demo goals |
| Creative Technologist | Experience Design | Owns pet personality, visual language, and motion style |
| CV Engineer | Computer Vision | Owns tracking, gesture mapping, and runtime stability |
| Graphics Engineer | Rendering | Owns hologram visuals, overlays, and animation composition |
| Audio Designer | Voice and SFX | Owns voice lines, timing, and playback feel |

## 3. Background

### Context

Most webcam computer vision demos stop at detection. They show boxes, landmarks, or raw gestures, but they do not create an emotional connection. For a robotics or innovation showcase, that often feels technical but not memorable.

HoloPet changes that by giving the audience a character to interact with. The camera becomes a stage where a digital creature seems to notice the user, respond, and build a small relationship in real time.

### Why Now

- Laptop cameras are now good enough for stable single-user tracking in controlled lighting.
- Real-time landmark tools like MediaPipe make pose, hand, and face signals practical on consumer hardware.
- Audiences respond strongly to experiences that combine AI, character design, and interaction rather than pure detection.

### What Has Recently Become Possible

It is now practical to build a convincing single-camera interaction loop without external depth sensors, custom hardware, or cloud inference. That means a compact demo can still feel premium and futuristic.

## 4. Objective

### Objective

Build a stage-friendly laptop-camera demo where a hologram pet appears, reacts, and speaks in a way that feels charming, technically impressive, and easy to understand in under 10 seconds.

### Why It Matters

- It turns computer vision from a background technology into a character-driven experience.
- It gives the team a strong showcase piece for events, portfolios, and future product pitches.
- It can evolve into multiple directions such as digital companion apps, museum exhibits, classroom tools, and therapeutic interaction systems.

### Strategic Fit

HoloPet sits at the intersection of robotics, vision, interaction design, and digital characters. It is a stronger showcase than a standard gesture-control demo because it demonstrates sensing, interpretation, and expressive response in one loop.

### Key Results

1. Within the first demo session, at least 80% of observers can explain what the system does in one sentence after watching for 10 seconds.
2. The MVP recognizes at least 4 core interactions with visible response accuracy above 85% in normal indoor lighting.
3. The end-to-end interaction latency stays under 150 ms on the target laptop for the core render loop.
4. At least 3 out of 5 pilot viewers describe the demo as "cute," "wow," or "alive" in post-demo feedback.
5. The live demo runs for 10 continuous minutes without crash or major tracking failure.

## 5. Market Segment(s)

### Primary Segment

Teams and creators who need a highly memorable live demo for robotics, AI, computer vision, or interactive media showcases.

### Secondary Segments

- Students building a competition or capstone project
- Creative coders making interactive installations
- Education teams teaching AI in a more friendly format
- Experience studios prototyping digital companions

### Constraints

- Must work with only a laptop camera
- Should be understandable from a distance by a live audience
- Should be stable in indoor event conditions
- Must not rely on long spoken conversation to succeed

## 6. Value Proposition(s)

### Customer Jobs

- "Help me show computer vision in a way people instantly enjoy."
- "Help me create a demo that looks more original than gesture control."
- "Help me turn a technical project into a character experience."

### Gains

- High audience attention
- Clear and playful storytelling
- Strong demo identity
- Good photo and video shareability

### Pains Removed

- Boring bounding-box demos
- Hard-to-explain technical showcases
- Demos that only look good to engineers
- Interactions that feel cold or generic

### Why This Is Better

Compared with typical webcam demos, HoloPet adds:

- Character and emotion
- Visible two-way interaction
- Stage-friendly reactions
- Stronger memory value for the audience

## 7. Solution

### 7.1 UX / Experience Flow

#### Entry

The webcam view opens with a subtle hologram UI. The user sees themselves and a small scan effect.

#### Summon

The user performs a simple gesture such as a wave or open palm. A portal or light burst appears and the pet enters the scene.

#### Bonding

The pet idles near the user, follows hand or shoulder anchors, and responds to simple cues.

#### Interaction

The user can trigger several reactions:

- Wave to greet
- Hold open palm to invite the pet closer
- Point left or right to move the pet
- Lean in to make the pet curious
- Smile to make the pet happy
- Use a special two-hand pose to trigger evolve mode

#### Finale

After enough successful interactions, the pet transforms into a brighter or stronger form and thanks the user.

### 7.2 Key Features

#### Real-Time User Tracking

Track one main user with body pose, face position, and hand landmarks.

#### Gesture Recognition

Support a small, stable set of gestures designed for reliability on a laptop camera.

#### Pet State Machine

Pet behavior is driven by states such as:

- hidden
- spawning
- idle
- curious
- following
- happy
- surprised
- evolved

#### Hologram Rendering

Render a stylized 2D pet with glow, particles, subtitle bubble, and simple HUD elements.

#### Voice and Subtitle Playback

Play short voice clips tied to pet state and show matching subtitle text on screen.

#### Progress and Reward Loop

Track trust, energy, or bond level so the interaction has a visible build-up.

### 7.3 Technology

- Webcam capture from OpenCV
- Landmark extraction using MediaPipe Holistic or split models
- Gesture logic based on landmark geometry and temporal smoothing
- 2D pet sprite or layered animation system
- Local audio playback with short pre-recorded voice lines

### 7.4 Assumptions

- One user is the main focus during the demo
- Indoor lighting is reasonably controlled
- A 2D hologram style is enough for a strong wow effect
- Short voice lines are better than open-ended chatbot speech for stage stability
- The first live version should optimize for reliability over feature count

## 8. Release

### Phase 1: MVP

Target a compact stage-ready demo with:

- 1 pet design
- 4 to 6 recognized interactions
- 4 emotional states
- 8 to 12 voice lines
- on-screen subtitle support
- basic evolve moment

### Phase 2: Enhanced Demo

- richer pet animations
- better face and smile response
- improved particle and portal effects
- pet memory between sessions
- stronger onboarding prompts

### Phase 3: Expandable Product Direction

- multiple pets
- educational mode
- therapy or calming companion mode
- game loops and collectible traits
- mobile or web adaptation
