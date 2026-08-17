# AI Air Canvas

Draw your idea in the air. Let AI bring it to life.

A fullscreen web demo for live stages: a presenter stands in front of a laptop webcam, draws in the air with their index finger (pinch to draw), then sends the sketch to `wan2.7-image-pro` to generate a polished image. No mouse, tablet, or stylus needed.

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
QWEN_API_URL=...
QWEN_API_KEY=...
QWEN_MODEL=wan2.7-image-pro
```

Keys stay server-side only. Request shape lives in `lib/qwen-provider.ts` — verify it against the real provider API before the show (model endpoint was unverified at build time).

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

## Show flow

1. Allow camera → `SHOW YOUR HAND TO BEGIN`
2. Raise hand → cursor appears, `HAND TRACKING ACTIVE`
3. Pinch thumb + index to draw, release to stop
4. Optionally pinch a style chip (REALISTIC / CINEMATIC / FUTURISTIC / 3D)
5. Pinch **GENERATE ✦** → staged loading → before/after reveal
6. Pinch **START AGAIN** → canvas resets without page reload
