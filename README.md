# AI Air Canvas

Draw your idea in the air. Let AI bring it to life.

A fullscreen web demo for live stages: a presenter stands in front of a laptop webcam, draws in the air with their index finger (pinch to draw), then sends the sketch to `qwen-image-3.0-pro` to generate a polished image. No mouse, tablet, or stylus needed.

Full product spec: [PRD-ai-air-canvas.md](./PRD-ai-air-canvas.md)

## Run

```bash
npm install
npm run dev
```

Open http://localhost:3000, allow camera access, show your hand.

- **Hand tracking** runs fully in the browser (MediaPipe Hand Landmarker). The webcam feed never leaves the machine.
- The microphone is captured only after pressing **M**. Audio is converted locally to 16 kHz mono WAV and sent to the server for Qwen transcription; it is not persisted by the app.
- Generation is **Qwen-only and fail-closed**. Missing credentials or provider failures are shown as errors instead of returning a mock or unrelated fallback image.

## Enable real AI generation

Copy `.env.local.example` to `.env.local` and fill in:

```
QWEN_API_URL=https://token-plan.ap-southeast-1.maas.aliyuncs.com/compatible-mode/v1
QWEN_API_KEY=...
QWEN_MODEL=qwen-image-3.0-pro
QWEN_ASR_MODEL=qwen-audio-3.0-realtime-plus
QWEN_PROMPT_MODEL=qwen3.7-plus
```

Keys stay server-side only. Request shape lives in `lib/qwen-provider.ts` (OpenAI-compatible mode, DashScope-native content items) — verified against the live endpoint, re-verify with `npm run check:qwen`.

## Stage crew keyboard failsafes

| Key | Action |
|---|---|
| `G` | Generate |
| `Z` | Undo |
| `X` | Clear (skips confirm) |
| `R` | Start again |
| `C` | Toggle camera preview |
| `D` | Debug panel |
| `F` | Fullscreen |
| `S` | Sound on/off |
| `V` | Toggle color palette |
| `B` | Calibration mode (hand range + pinch threshold) |
| `M` | Capture a spoken image prompt (auto-stops after silence; press again to cancel) |

## Spoken image prompt (press `M`)

Press `M` once, speak the desired image, then pause. Recording stops automatically after silence. The on-screen prompt badge shows the final text; press `M` again to replace it. GENERATE remains disabled until both a sketch and a confirmed visible prompt exist.

The camera panel includes a stage-readable **PROMPT MONITOR**: `HEARD` shows the raw Qwen Audio transcript and `IMAGE PROMPT` shows the agent-corrected text. Pressing GENERATE is the presenter's explicit confirmation; pressing `M` replaces a bad transcript. React escapes displayed transcript text, and the server independently limits and sanitizes prompt input.

The server pipeline is intentionally separated by responsibility:

1. `qwen-audio-3.0-realtime-plus` transcribes the 16 kHz PCM audio. The realtime model's audio reply is disabled; only its official input-transcript event is used.
2. `qwen3.7-plus` corrects likely Indonesian/English ASR errors. It may inspect the sketch only to disambiguate a corrupted subject noun and is explicitly forbidden from copying sketch style or inventing details.
3. `qwen-image-3.0-pro` receives the sketch PNG, visible spoken prompt text, and selected style as one image-to-image request.

The API key remains server-side throughout. Generation never silently falls back to a different provider.

## Finger gestures

Everything runs through the camera — hold the pose for a moment to trigger it. Thumb counts only when it's out (pinching tucks it in), so the counts below mean "fingers raised".

| Fingers | Action |
|---|---|
| 2 (index + middle) | Open/close the color palette |
| 3 | Open/close the shape picker (line, curve, circle, square, triangle) |
| 4 | Toggle eraser on/off |
| 5 (open palm) | Open/close the main menu (UNDO / CLEAR / GENERATE / style) |

After picking a shape, the next pinch-drag draws that shape — drag from corner to corner, release to commit. Picking a color switches the tool back to pen automatically.

The canvas is button-free while drawing — all actions live in the 5-finger menu popup. UNDO and CLEAR need two presses (arm, then confirm) so a stray hand can't wipe work.

## Accidental-press safety

The canvas has **no always-visible buttons** — everything lives behind the 5-finger menu popup, so nothing can be hit by accident while drawing. Inside the menu, **UNDO** and **CLEAR** need two presses: the first arms it (button pulses, 3s timeout), the second executes. Keyboard failsafes (`Z`/`X`) and voice commands still execute immediately.

## Cursor smoothing

The cursor runs through a One-Euro Filter (`lib/one-euro.ts`) — the standard for noisy hand tracking: heavy smoothing while the hand is still (no shake), light smoothing during fast moves (no lag, straight lines stay straight). Tunables live in `lib/constants.ts` as `ONE_EURO_MIN_CUTOFF` (lower = steadier at rest) and `ONE_EURO_BETA` (higher = tracks the hand more closely at speed).

On top of that, stroke points pass through a **pen deadzone** (`PEN_DEADZONE_PX` in `lib/constants.ts`, applied in `applyPenDeadzone`): movement smaller than the deadzone never joins the stroke, so a held hand draws no wiggle — like a real pen whose tip doesn't slide. Slow deliberate moves accumulate past the deadzone and still register. Verify both with `npm run check:one-euro`.

The filter is regression-tested with post-calibration camera jitter of ±6 px, not only idealized sub-pixel noise. Run `npm run check:pen-stability` to enforce the resting spread, maximum frame step, fast-stroke lag, and slow-stroke precision budgets.

## Show flow

1. Allow camera → `SHOW YOUR HAND TO BEGIN`
2. Raise hand → cursor appears, `HAND TRACKING ACTIVE`
3. Pinch thumb + index to draw, release to stop
4. Press `M`, speak the image prompt, and verify the visible prompt badge
5. Optionally pinch a style chip (REALISTIC / CINEMATIC / FUTURISTIC / 3D)
6. Pinch **GENERATE ✦** → staged loading → before/after reveal
7. Pinch **START AGAIN** → canvas and spoken prompt reset without page reload
