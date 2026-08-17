# PRD — AI Air Canvas

## 1. Summary

AI Air Canvas is a fullscreen web application for live stage demonstrations. A presenter draws in the air using their hand and a laptop webcam, then the rough sketch is automatically sent to an AI image model (`wan2.7-image-pro`) that transforms it into a polished, professional image. The audience sees a person wave their hand, lines appear on screen, and a beautiful AI image materializes — no mouse, no tablet, no visible technology.

## 2. Contacts

| Name | Role | Comment |
|------|------|---------|
| Mekari | Product Owner / Sole Developer | All decisions |

## 3. Background

**Context.** The existing `holopet-cv` project (a webcam-driven virtual pet with body tracking) is being retired. Its purpose shifts from an always-on companion to a **one-shot stage demonstration tool**: showcase computer vision + generative AI in a single, memorable moment.

**Why now.** The team needs a reliable, visually impressive demo for an upcoming live event. Hand-tracking (MediaPipe) runs entirely in-browser, and image-generation APIs now accept a reference image as input — both were recently mature enough to combine into a seamless sketch-to-image pipeline.

**What changed.** Previous holopet was a persistent experience. The new direction is a focused, repeatable magic trick: **draw → generate → reveal**. Simpler scope, higher impact.

## 4. Objective

**Objective:** Deliver a reliable, stage-ready web app where a presenter can draw in the air with their hand and produce a polished AI image from the sketch — without touching any input device.

**Why it matters:** The demo is the product. It must feel like magic on stage. Reliability and low perceived latency beat feature count.

**Key Results (OKR):**

| Key Result | Target | How measured |
|---|---|---|
| MVP acceptance test (22 steps) passes end-to-end | 100% | Manual test script |
| Hand tracking cursor feels smooth | ≥25 FPS perceived | Dev panel FPS counter |
| Image generation completes | <10s (p50) | Generation latency log |
| Full reset cycle (START AGAIN) works without page reload | 5+ consecutive cycles | Manual test |
| App survives camera permission denial gracefully | Yes | Manual test |

## 5. Market Segment(s)

**Primary user:** The presenter on stage — a technical or product person who needs to demonstrate AI capability to a live audience. They stand 1–2 meters from the laptop webcam.

**Secondary user:** The event operator / stage crew — needs keyboard failsafes, fullscreen mode, sound toggle, and debug panel to troubleshoot before and during the show.

**Constraint:** The app runs on the presenter's own laptop, local-first. Only the image-generation API call requires internet. No login, no database, no accounts.

## 6. Value Proposition(s)

**Job:** "Show a live audience that AI can understand and elevate human creativity — in under 60 seconds."

**Gain:** The audience sees a hand draw in the air, then watches that rough sketch become a stunning image. The message lands without a single technical explanation.

**Pain avoided:**
- No need for a drawing tablet or stylus on stage (awkward, small, hard to see).
- No need to type a prompt mid-show (breaks the flow, looks like a developer tool).
- No risk of live demo failure from complex setup (local CV, single API call).

**Differentiation:** Most sketch-to-image demos require a physical drawing device or pre-made images. This is fully hands-free — the technology is invisible.

## 7. Solution

### 7.1 UX / User Flow

```
INITIALIZING
  → CAMERA_PERMISSION
    → READY (show hand to begin)
      → DRAWING (pinch to draw)
        → CAPTURE (GENERATE activated)
          → GENERATING (staged loading animation)
            → REVEAL (sketch fades into AI image)
              → RESULT (before/after side by side)
                → RESET (START AGAIN)
```

**Main drawing screen:**
- Canvas occupies ~65–75% of screen, dark line on white background.
- Large buttons: UNDO, CLEAR, GENERATE ✨ — sized for imprecise hand pointing (min 80px virtual hit area).
- Small status indicator: "● HAND TRACKING ACTIVE" or "SHOW YOUR HAND TO BEGIN".
- Optional small webcam preview in corner (toggle with `C`).

**Result screen:**
- Left: rough sketch. Right: AI-generated image.
- Labels: "YOUR IDEA" / "AI CREATION".
- Large START AGAIN button.
- Optional fullscreen reveal of the AI result after a few seconds.

**Virtual cursor:**
- Small circle with outer ring. States: normal, pinch (contracts), hover (ring expands), click (ripple).
- Not a standard mouse cursor shape.

### 7.2 Key Features

**P0 — Must ship (MVP):**

1. **Hand tracking cursor.** MediaPipe Hand Landmarker in-browser. Index fingertip (landmark 8) = cursor. Exponential smoothing (factor 0.25–0.40, configurable). Interaction region = center 70–80% of camera frame mapped to full canvas. Mirrored so presenter's right = screen right.

2. **Pinch-to-draw.** Distance between thumb tip (landmark 4) and index tip (landmark 8). Below threshold A = pen down. Above threshold B (B > A) = pen up. Hysteresis prevents flicker.

3. **Canvas drawing.** `CanvasRenderingContext2D`, round caps/joins, stroke smoothing via quadratic Bézier or Catmull-Rom. Strokes stored as structured array (`strokes[]` with points + width). White background baked in on export.

4. **UNDO.** Removes last stroke from array. Re-renders canvas.

5. **CLEAR.** Requires confirmation — either 1-second dwell on button or a second pinch on a "CONFIRM" prompt. Never clears instantly on single gesture.

6. **GENERATE.** Freezes drawing. Captures canvas as PNG via `canvas.toBlob()`. Sends to backend. Blocks re-trigger during active request. Shows "SKETCH CAPTURED ✓" immediately.

7. **Backend generation endpoint.** Next.js API route. Receives PNG, builds prompt (system-generated, no manual typing), calls `wan2.7-image-pro` with sketch as reference image. Returns generated image URL or base64. API key server-side only.

8. **Staged loading animation.** Four phases: "CAPTURING YOUR IDEA" → "UNDERSTANDING YOUR SKETCH" → "CREATING WITH AI" → "BRINGING YOUR IDEA TO LIFE". No fake percentages.

9. **Reveal transition.** ~1–2 seconds after asset received: sketch illuminates, scan animation, AI image fades in over sketch, then result expands.

10. **Result screen + START AGAIN.** Before/after layout. START AGAIN resets all state without page reload. Camera and MediaPipe stay active.

11. **Keyboard failsafes.** `G` generate, `Z` undo, `X` clear, `R` reset, `C` toggle camera, `D` debug mode, `F` fullscreen.

12. **Error handling.** Camera denied, hand not detected, AI timeout, API error, network failure — all handled with clear stage-readable messages. Sketch never deleted on failure.

**P1 — Stage polish (post-MVP):**

13. **Calibration mode.** Measure comfortable hand range and pinch threshold before show. Store in `localStorage`.

14. **Debug panel.** Camera FPS, CV FPS, hand detected, handedness, index X/Y, pinch distance/state, app state, generation latency, API status. Hidden in Stage Mode.

15. **Style selector.** REALISTIC / CINEMATIC / FUTURISTIC / 3D — appended to prompt automatically. Activated by hand, no keyboard.

16. **Sound effects.** Subtle sounds for tracking, click, capture, generation, reveal. Toggle on/off.

17. **Fullscreen mode.** Browser Fullscreen API. Remove all browser chrome feel.

**Explicitly NOT in scope:**
- Voice prompts
- Object recognition
- Image-to-video
- Multi-hand controls
- Collaborative canvas
- Login / database / social sharing
- Virtual keyboard

### 7.3 Technology

| Layer | Choice | Rationale |
|---|---|---|
| Framework | Next.js + TypeScript + React | API routes + frontend in one package |
| Styling | Tailwind CSS | Fast, responsive, stage-readable |
| Hand tracking | MediaPipe Tasks Vision (CDN/npm) | Free, local, no server needed |
| Canvas | HTML5 Canvas API | Native, no dependency |
| Animation | Framer Motion | Reveal transitions, cursor states |
| Image gen | `wan2.7-image-pro` via configurable adapter | Provider-agnostic interface |
| Env | `.env.local`: `QWEN_API_URL`, `QWEN_API_KEY`, `QWEN_MODEL` | Key never in browser bundle |

**Architecture rule:** `ImageGenerationProvider` interface with `generate(referenceImage, prompt, options)`. Frontend never calls AI directly. All AI requests go through `/api/generate`.

**Privacy:** Webcam processed locally only. No video stored or sent. Only canvas PNG leaves the browser.

### 7.4 Assumptions

| # | Assumption | Risk if wrong | Validation |
|---|---|---|---|
| A1 | `wan2.7-image-pro` accepts a reference image as input (image-to-image) | Cannot use sketch as input; must use text-only | Test API call with sample sketch |
| A2 | `wan2.7-image-pro` is accessible via HTTP API with a simple key | Need complex auth or SDK | Confirm endpoint and auth method |
| A3 | Generation completes in <10s typically | Stage demo feels slow | Benchmark with real sketches |
| A4 | MediaPipe Hand Landmarker achieves ≥25 FPS on presenter's laptop | Cursor feels laggy | Test on target hardware |
| A5 | Pinch gesture is reliably distinguishable at 1–2m from webcam | False draws or missed draws | Calibrate on target hardware |

> **Open question:** The model ID `wan2.7-image-pro` was not found in public search. Confirm: is this served via DashScope (Alibaba Cloud), fal.ai, or another provider? The backend adapter pattern makes the provider swappable once confirmed.

## 8. Release

**Phase 1 — Computer Vision** (~2–3 days)
Webcam → hand → index fingertip cursor. Success: cursor follows finger smoothly.

**Phase 2 — Air Drawing** (~2–3 days)
Pinch → draw. Success: presenter draws recognizable simple shapes (house, car, tree).

**Phase 3 — Canvas Controls** (~1–2 days)
Undo, Clear (with confirm), Generate button. All controllable by hand.

**Phase 4 — AI Generation** (~2–3 days)
Canvas PNG → backend → wan2.7-image-pro → image returned. Success: sketch generates an image.

**Phase 5 — Result & Reset** (~2 days)
Loading animation, reveal transition, before/after screen, START AGAIN cycle.

**Phase 6 — Stage Polish** (~3–4 days)
Calibration, debug panel, keyboard failsafes, fullscreen, sound, responsive layout, style selector.

**Total estimate:** ~2–3 weeks from start to stage-ready.

**First version vs. future:**
- V1: Everything in P0. Single style (no selector). No sound. No calibration UI.
- V2: P1 features. Style selector. Calibration mode. Sound design.
- V3 (post-event): Voice prompt, object recognition, image-to-video, multi-hand.

---

*This PRD replaces all holopet-cv specifications. The prior codebase is retired.*
