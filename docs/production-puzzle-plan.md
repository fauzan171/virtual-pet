# HoloPet Production Puzzle Plan

This breaks the current production pass into finishable pieces.

## Finished Pieces

1. `Hermes Core`
Hermes-style planning is the main structured action layer.

2. `Movement Pipe`
`movement.target_anchor` survives planner -> state -> renderer and visibly affects placement.

3. `Persistence`
Pet session memory persists locally across runs.

4. `Voice Boundaries`
Listener, STT, and TTS abstractions exist with local-safe fallbacks.

## Next Finishable Pieces

1. `Live Dialogue Piece`
Goal:
Run camera mode and dialogue loop together without breaking camera-only mode.

Done when:
- camera-only mode still works
- Hermes mode can also accept live dialogue
- typed or scripted dialogue updates subtitles, movement, and optional voice
- if voice input is unavailable, the pet still works visually

2. `Movement Accuracy Piece`
Goal:
Make anchors feel distinct and stable.

Done when:
- `right_shoulder`, `left_shoulder`, `active_palm`, and `nose` look clearly different
- movement smoothing avoids obvious jitter
- low confidence produces a gentle pet reply

3. `Memory Depth Piece`
Goal:
Expand what the pet remembers.

Done when:
- remembers `user_name`
- remembers `favorite_color`
- remembers `last_topic`
- survives restart

4. `Character Lock Piece`
Goal:
Keep the pet companion-like instead of assistant-like.

Done when:
- replies stay brief
- physical commands cause movement plus a short response
- visual state affects tone

5. `Provider Swap Piece`
Goal:
Make local and future speech providers drop-in replacements.

Done when:
- local mock path works offline
- macOS `say` still works
- future STT/TTS providers can be added without changing planner code

## Current Production Assumption

Until a real microphone backend lands, the live dialogue path should prefer CLI-safe input methods:

- scripted utterances
- stdin polling
- mock captures for self-test

That keeps the feature runnable from Codex CLI and preserves the camera demo.
