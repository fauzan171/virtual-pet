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
- **Only the sketch PNG** is sent to the backend on GENERATE.
- Without API credentials the app runs in **mock mode** (echoes the sketch back) so the full flow is testable offline.

## Enable real AI generation

Copy `.env.local.example` to `.env.local` and fill in:

```
QWEN_API_URL=https://token-plan.ap-southeast-1.maas.aliyuncs.com/compatible-mode/v1
QWEN_API_KEY=...
QWEN_MODEL=qwen-image-3.0-pro
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
| `M` | Voice commands on/off |

## Voice commands (press `M`)

Runs fully in the browser via the Web Speech API (Chrome/Edge). Say:

| Command | Effect |
|---|---|
| `generate [something]` | Start generation; text after "generate" becomes the subject hint for the free engine |
| `undo` | Undo last stroke |
| `clear` then `confirm` | Clear canvas (two-step) |
| `reset` / `start again` | Back to a fresh canvas |

Generation agent (`lib/agent.ts`): with `QWEN_API_KEY` the sketch goes to the model (img2img). Without a key, the spoken subject + selected style are sent to Pollinations (free, no key) so the show flow still works end to end.

Spoken subjects pass through a safety layer (`sanitizeSubject` in `lib/voice.ts`) before reaching the image model — STT filler words are stripped, empty/absurd input is rejected. The check is applied again server-side at the API route. Verify with `npm run check:voice-guard`.

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

## Show flow

1. Allow camera → `SHOW YOUR HAND TO BEGIN`
2. Raise hand → cursor appears, `HAND TRACKING ACTIVE`
3. Pinch thumb + index to draw, release to stop
4. Optionally pinch a style chip (REALISTIC / CINEMATIC / FUTURISTIC / 3D)
5. Pinch **GENERATE ✦** → staged loading → before/after reveal
6. Pinch **START AGAIN** → canvas resets without page reload
