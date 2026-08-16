# HoloPet CV

HoloPet CV is a laptop-camera interactive demo where a hologram pet appears on screen, reacts to body movement, hand gestures, face position, and simple expressions, and speaks back with short playful voice lines.

The current build supports two response modes:

- `local brain`: offline personality engine with mood, bond, and idle chatter
- `openai-compatible brain`: optional API-backed dialogue layer with local fallback
- `remote planner`: direct OpenAI-compatible pet planner with memory, movement, and remote/fallback routing
- `hermes bridge`: structured agent layer with persistent memory, movement plans, and voice-ready hooks

The runtime architecture is:

1. Perception
2. World State
3. Agent Planner
4. Action Plan
5. Animation, Movement, Subtitles, and Voice

## Project Goals

- Create a live demo that feels magical within 3 seconds
- Keep hardware requirements to a single laptop camera
- Make the first version stable enough for a stage demo
- Leave room for product expansion into education, therapy, entertainment, or installation art

## Suggested Stack

- Python 3.11+
- OpenCV
- MediaPipe
- NumPy
- Pygame or OpenCV-based frame compositing

## Folder Structure

- `docs/`: product and technical requirements
- `src/app/`: main application entrypoints
- `src/core/`: state machine and shared domain models
- `src/cv/`: webcam ingestion, landmark tracking, gesture logic
- `src/render/`: hologram rendering, UI, subtitles
- `src/audio/`: voice playback and timing
- `assets/`: sprites, sound effects, UI textures
- `configs/`: thresholds and interaction tuning
- `tests/`: unit and integration tests

## Production Notes

- Core demo behavior is local-first and does not require internet access.
- Hermes memory persists to `data/pet_memory.json` by default and can be redirected with `--memory-path`.
- Remote planner defaults live in `configs/remote_brain.yaml`. Keep the secret in `HOLOPET_REMOTE_API_KEY`.
- Voice is modular: `src/audio/listener.py`, `src/audio/stt.py`, `src/audio/tts.py`, and `src/audio/session.py` provide local-safe capture, transcription, half-duplex turn control, and playback.
- Voice turns expose `LISTENING`, `TRANSCRIBING`, `THINKING`, `SPEAKING`, and `ERROR` in the HUD. The microphone stays closed while HoloPet speaks, and a failed turn cannot kill the worker.
- Camera-only mode remains valid. If voice is unavailable, the pet still renders, moves, and subtitles normally.
- `movement.target_anchor` drives named placement from head/chest/arms through ankles and feet, plus the active palm and pointing target.
- Body placement is person-relative: visible-person segmentation supplies body bounds, all major pose anchors extend through ankles and feet, and offsets/pet size scale with shoulder width instead of fixed screen pixels.
- Movement uses a frame-rate-independent controller, holds through short landmark dropouts, and keeps an explicit voice/gesture target active until a new movement intent arrives.
- The HUD now shows `BRAIN: REMOTE`, `BRAIN: FALLBACK`, or `BRAIN: LOCAL` so you can see whether the reply came from the remote model or the local rescue path.

Run with `--debug` to inspect the selected visible-person bounds, body anchors, resolved motion target, confidence, and direct/held/fallback/frozen tracking state. “Full body” means the full visible segmented person; a single webcam cannot recover limbs outside the frame or behind an occlusion.

## Run

Create a local virtual environment and install dependencies:

```bash
python3.11 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
```

### Showcase quick start

One clean command for a live demo with chat and spoken lines:

```bash
./run_holopet.sh --brain hermes --dialogue-stdin --voice
```

The default `./run_holopet.sh` below still runs a fully working webcam demo.

Run a camera-free smoke test:

```bash
python3 -m src.app.main --self-test --brain local
```

Run the webcam demo:

```bash
./run_holopet.sh
```

Optional voice mode on macOS:

```bash
./run_holopet.sh --voice
```

Real microphone conversation (local Whisper STT plus the selected dialogue brain):

```bash
./run_holopet.sh --brain remote --mic --voice
```

If the microphone or Whisper cannot initialize, HoloPet falls back to typed
dialogue instead of treating raw WAV bytes as text. macOS `say` is used for
spoken replies; camera tracking continues while the dialogue brain is thinking.

Optional AI model mode:

```bash
export OPENAI_API_KEY=your_key_here
export HOLOPET_OPENAI_MODEL=gpt-4.1-mini
./run_holopet.sh --brain openai --dialogue-stdin --voice
```

OpenAI is used only for dialogue on the background worker; camera gestures stay
local and responsive. If the API is unavailable, HoloPet falls back to the
local dialogue brain automatically. Use `--mic --voice` instead of
`--dialogue-stdin --voice` for real microphone conversation.

Recommended remote pet mode:

```bash
export HOLOPET_REMOTE_API_KEY=your_key_here
./run_holopet.sh --brain remote --mic --voice
```

Live dialogue during the camera demo (type lines in the terminal):

```bash
./run_holopet.sh --brain remote --dialogue-stdin
```

Dialogue is handled off the camera thread, so a slow remote model never
freezes tracking. The HUD shows `BRAIN: REMOTE` or `BRAIN: FALLBACK (LOKAL)`
so the audience can see which brain answered.

Hermes-style scaffolding mode:

```bash
./run_holopet.sh --brain hermes
./run_holopet.sh --self-test --brain hermes
./run_holopet.sh --self-test --brain hermes --utterance "namaku siapa"
```

What `hermes` adds today:

- structured action plans
- persistent session memory
- movement target execution in the renderer
- clean dialogue loop scaffolding
- hook points for microphone capture, speech-to-text, and text-to-speech

### New Modules

- `src/audio/listener.py`: microphone capture boundary with mock and null listeners for self-test flows
- `src/audio/stt.py`: pluggable speech-to-text interface with a local mock fallback
- `src/audio/tts.py`: text-to-speech interface with macOS `say` support and test doubles
- `src/audio/session.py`: half-duplex voice turn lifecycle, status, cancellation, and per-turn recovery
- `src/agent/persistence.py`: JSON-backed save and load for memory and session state
- `src/agent/dialog_loop.py`: utterance-to-plan loop that routes subtitle, movement, and voice actions

### Test Commands

```bash
python3 -m unittest discover -s tests
./run_holopet.sh --self-test --brain hermes --utterance "namaku siapa"
./run_holopet.sh --self-test --brain remote --utterance "Namaku Jadi"
```

## Camera Permission Note

On macOS, OpenCV needs camera access permission. If the app prints a camera authorization error, allow camera access for the terminal or app process that is launching HoloPet in:

`System Settings -> Privacy & Security -> Camera`
