"""Application entrypoint for the runnable HoloPet MVP."""

from __future__ import annotations

import argparse
from dataclasses import dataclass, replace
import os
import queue
import time
import warnings
from pathlib import Path

# ponytail: mediapipe's protobuf layer spams GetPrototype deprecation warnings
# every frame; silence them instead of fixing upstream.
warnings.filterwarnings("ignore", message="SymbolDatabase.GetPrototype() is deprecated.")

PROJECT_ROOT = Path(__file__).resolve().parents[2]
os.environ.setdefault("MPLCONFIGDIR", str(PROJECT_ROOT / ".cache" / "matplotlib"))
os.environ.setdefault("XDG_CACHE_HOME", str(PROJECT_ROOT / ".cache"))

import cv2
import yaml

from src.audio.listener import AudioCapture, MockMicrophoneListener, SoundDeviceMicrophoneListener, StdinMicrophoneListener
from src.audio.player import VoicePlayer
from src.audio.stt import MockSpeechToText
from src.audio.tts import MacOSSayTextToSpeech, NullTextToSpeech
from src.brain.hermes_bridge import HermesBridgeBrain
from src.brain.local_brain import LocalPetBrain
from src.brain.openai_brain import OpenAIPetBrain
from src.brain.remote_bridge import RemoteBridgeBrain
from src.core.models import InteractionEvent, PetContext, TrackingSnapshot
from src.core.state_machine import HoloPetStateMachine
from src.cv.tracker import GestureTracker
from src.render.renderer import HoloPetRenderer


def load_config() -> dict:
    config_path = PROJECT_ROOT / "configs" / "interaction.yaml"
    with config_path.open("r", encoding="utf-8") as handle:
        return yaml.safe_load(handle)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Run the HoloPet webcam demo.")
    parser.add_argument("--camera-index", type=int, default=0)
    parser.add_argument("--voice", action="store_true", help="Enable macOS text-to-speech for pet lines.")
    parser.add_argument("--debug", action="store_true", help="Show tracking points and diagnostic text.")
    parser.add_argument("--self-test", action="store_true", help="Run a camera-free logic test.")
    parser.add_argument("--no-window", action="store_true", help="Skip creating an OpenCV window.")
    parser.add_argument("--max-frames", type=int, default=0, help="Stop after N frames. Zero means run until quit.")
    parser.add_argument("--brain", choices=("auto", "local", "openai", "remote", "hermes"), default="auto", help="Choose the pet response provider.")
    parser.add_argument("--memory-path", default=str(PROJECT_ROOT / "data" / "pet_memory.json"), help="Path for Hermes memory persistence.")
    parser.add_argument("--utterance", action="append", default=[], help="Inject a dialogue utterance during self-test.")
    parser.add_argument("--dialogue-stdin", action="store_true", help="Poll terminal stdin for dialogue while the camera demo is running.")
    parser.add_argument("--dialogue-script", action="append", default=[], help="Queue scripted dialogue lines during the live camera demo.")
    parser.add_argument("--probe-remote", action="store_true", help="Run a remote dialogue probe without camera mode.")
    parser.add_argument("--skin", default=None, help="Pet character skin: fox, cat, or bunny. Overrides render.skin in the config.")
    parser.add_argument("--mic", action="store_true", help="Listen to the microphone and transcribe speech locally with Whisper.")
    parser.add_argument("--whisper-model", default="base", help="faster-whisper model size when --mic is set (tiny, base, small).")
    return parser.parse_args()


def build_brain(provider_name: str, memory_path: str):
    if provider_name == "remote":
        return RemoteBridgeBrain.from_env(memory_path=memory_path) or LocalPetBrain()
    if provider_name == "hermes":
        return HermesBridgeBrain(memory_path=memory_path)
    if provider_name == "local":
        return LocalPetBrain()
    if provider_name == "openai":
        return OpenAIPetBrain.from_env() or LocalPetBrain()
    return RemoteBridgeBrain.from_env(memory_path=memory_path) or OpenAIPetBrain.from_env() or LocalPetBrain()


def run_self_test(config: dict, brain_name: str, memory_path: str, utterances: list[str]) -> int:
    brain = build_brain(brain_name, memory_path)
    machine = HoloPetStateMachine(config["cooldowns"], brain=brain)
    script = ["wave", "open_palm", "smile", "point_left", "point_right", "lean_in", "two_hand_pose"]
    for name in script:
        expression = machine.process(InteractionEvent(name=name), now=time.monotonic())
        print(f"{name:>14} -> {expression.state:>10} | {expression.mood:>8} | {expression.subtitle}")
        time.sleep(0.2)
    idle = machine.process(None, now=time.monotonic() + 9)
    print(f"{'idle_tick':>14} -> {idle.state:>10} | {idle.mood:>8} | {idle.subtitle}")
    context = machine._context(tracking_confidence=1.0)
    # Every brain builds a dialog loop now (bridges use their planner, others
    # fall back to the local Hermes-like planner), so dialogue self-test runs
    # for all modes.
    dialog_loop = brain.build_dialog_loop(tts=NullTextToSpeech())
    scripted = utterances or ["namaku siapa", "ke bahu kiri"]
    for result in dialog_loop.run_self_test(context=context, utterances=scripted):
        print(f"dialog_self -> {result.utterance} => {result.plan.reply} | src={result.plan.response_source} | {result.memory_summary}")
    print("self-test complete")
    return 0


def run_remote_probe(brain_name: str, memory_path: str, utterances: list[str]) -> int:
    brain = build_brain(brain_name, memory_path)
    context = PetContext(
        state="happy",
        mood="joyful",
        bond=3,
        energy=0.72,
        interaction_count=5,
        last_event="smile",
        memory_summary="empty",
        tracking_confidence=1.0,
    )
    dialog_loop = brain.build_dialog_loop(tts=NullTextToSpeech())
    scripted = utterances or ["Namaku Jadi", "ke bahu kanan", "namaku siapa"]
    print(f"remote_probe brain={brain.provider_name}")
    start = time.monotonic()
    fallback_turns = 0
    for result in dialog_loop.run_self_test(context=context, utterances=scripted):
        if result.plan.response_source != "remote":
            fallback_turns += 1
        print(f"probe -> {result.utterance} => {result.plan.reply} | src={result.plan.response_source} | move={result.plan.movement.target_anchor}")
    elapsed = time.monotonic() - start
    print(f"probe_summary turns={len(scripted)} remote={len(scripted) - fallback_turns} fallback={fallback_turns} elapsed={elapsed:.1f}s")
    if fallback_turns:
        print("probe_note: remote lambat atau tidak tersedia, fallback lokal yang menjawab. Demo tetap aman.")
    return 0


def build_voice_input(whisper_model_name: str):
    """Build one valid input pair, falling back atomically to typed dialogue."""

    try:
        listener = SoundDeviceMicrophoneListener()
        listener.validate_input()
    except Exception as error:
        print(f"warning: microphone unavailable ({error})")
        return StdinMicrophoneListener(), MockSpeechToText()
    try:
        from src.audio.stt import WhisperSpeechToText

        stt = WhisperSpeechToText(model_name=whisper_model_name)
    except Exception as error:
        # Raw WAV bytes must never fall through to MockSpeechToText.  If the
        # real transcriber cannot start, disable the mic and use a matched
        # typed-input pair instead.
        print(f"warning: whisper unavailable ({error}); switching to typed dialogue")
        return StdinMicrophoneListener(), MockSpeechToText()
    return listener, stt


def open_camera(index: int, config: dict) -> cv2.VideoCapture:
    cap = cv2.VideoCapture(index)
    cap.set(cv2.CAP_PROP_FRAME_WIDTH, config["camera"]["width"])
    cap.set(cv2.CAP_PROP_FRAME_HEIGHT, config["camera"]["height"])
    cap.set(cv2.CAP_PROP_FPS, config["camera"]["fps_target"])
    return cap


@dataclass(frozen=True, slots=True)
class _VoiceInputSnapshot:
    """A detached, single-frame view consumed by the voice worker."""

    context: PetContext
    tracking: TrackingSnapshot | None


class _VoiceInputSnapshotStore:
    """Atomically swaps context/tracking together instead of sharing the machine."""

    def __init__(self, machine: HoloPetStateMachine) -> None:
        self._snapshot = _VoiceInputSnapshot(
            context=machine._context(tracking_confidence=1.0),
            tracking=None,
        )

    def update(self, machine: HoloPetStateMachine, tracking: TrackingSnapshot) -> None:
        # `_context` constructs a fresh PetContext.  Replacing one object
        # reference is atomic under CPython, and the published objects are not
        # mutated by the camera loop afterward.
        self._snapshot = _VoiceInputSnapshot(
            context=machine._context(tracking_confidence=tracking.tracking_confidence),
            tracking=tracking,
        )

    def context(self) -> PetContext:
        return self._snapshot.context

    def tracking(self) -> TrackingSnapshot | None:
        return self._snapshot.tracking


def _start_dialogue_session(loop, snapshots: _VoiceInputSnapshotStore, results: "queue.Queue", config: dict):
    """Start the generic voice worker with camera-safe input suppliers."""

    return loop.start_voice_session(
        context_supplier=snapshots.context,
        tracking_supplier=snapshots.tracking,
        result_sink=results.put,
        capture_timeout_s=float(config.get("capture_timeout_s", 0.25)),
        min_transcript_confidence=float(config.get("min_transcript_confidence", 0.35)),
        failure_backoff_s=float(config.get("failure_backoff_s", 0.25)),
        post_speech_guard_ms=int(config.get("post_speech_guard_ms", 250)),
    )


def _stop_voice_session(session) -> None:
    if session is None:
        return
    session.stop()
    session.join(timeout=2.0)


def _voice_status_text(session) -> str | None:
    """Flatten VoiceStatus for the renderer without importing audio types."""

    if session is None:
        return None
    status = session.status
    state = getattr(status, "state", getattr(session, "state", "idle"))
    label = getattr(state, "value", str(state)).lower()
    error = getattr(status, "error", None)
    if error:
        return f"{label}: {error}"[:64]
    return label


def _voice_session_is_speaking(session) -> bool:
    if session is None:
        return False
    state = getattr(session.status, "state", getattr(session, "state", "idle"))
    return getattr(state, "value", str(state)).lower() == "speaking"


def _speak_camera_line(dialogue_loop, voice_player, line: str | None) -> bool:
    """Use the session speaker when active so capture stays half-duplex."""

    if not line:
        return False
    session = getattr(dialogue_loop, "voice_session", None) if dialogue_loop is not None else None
    if session is not None:
        return bool(dialogue_loop.request_speech(line, interrupt=True))
    if voice_player is not None:
        voice_player.speak(line)
        return True
    return False


def _interrupt_dialogue_speech(dialogue_loop) -> bool:
    """Stop stale dialogue audio when a physical gesture replaces its subtitle."""

    session = getattr(dialogue_loop, "voice_session", None) if dialogue_loop is not None else None
    if session is None:
        return False
    return bool(dialogue_loop.interrupt_speech())


def _select_active_expression(
    camera_expression,
    dialogue_expression,
    *,
    dialogue_until: float,
    now: float,
    interrupt_dialogue: bool,
    dialogue_speaking: bool = False,
):
    """Let a fresh physical gesture interrupt an older dialogue overlay."""

    if interrupt_dialogue or (
        dialogue_expression is not None
        and now > dialogue_until
        and not dialogue_speaking
    ):
        dialogue_expression = None
    if dialogue_expression is not None:
        return dialogue_expression, dialogue_expression
    return camera_expression, None


def _merge_dialogue_with_gesture(dialogue_expression, camera_expression, *, has_gesture: bool):
    """Keep fresh dialogue text while preserving same-frame local visuals."""

    if not has_gesture:
        return dialogue_expression
    return replace(
        dialogue_expression,
        state=camera_expression.state,
        color=camera_expression.color,
        mood=camera_expression.mood,
        movement=camera_expression.movement,
        animation=camera_expression.animation,
        bond_level=camera_expression.bond_level,
        energy=camera_expression.energy,
        emote=camera_expression.emote,
    )


def _preserve_gesture_ownership(machine, dialogue_expression, camera_expression, *, event_name: str):
    """Restore state-machine ownership after applying a stale queued plan."""

    merged = _merge_dialogue_with_gesture(
        dialogue_expression,
        camera_expression,
        has_gesture=True,
    )
    machine.state = camera_expression.state
    machine.mood = camera_expression.mood
    machine.last_event_name = event_name
    machine.active_movement = camera_expression.movement
    machine.last_expression = merged
    return merged


def run_camera_demo(args: argparse.Namespace, config: dict) -> int:
    cap = open_camera(args.camera_index, config)
    if not cap.isOpened():
        print("error: camera could not be opened")
        return 1

    brain = build_brain(args.brain, args.memory_path)
    tracker = GestureTracker(config)
    machine = HoloPetStateMachine(config["cooldowns"], brain=brain)
    skin = args.skin or config["render"].get("skin", "fox")
    renderer = HoloPetRenderer(
        subtitle_y_offset=config["render"]["subtitle_y_offset"],
        skin=skin,
        motion_config=config.get("motion"),
    )
    dialogue_loop = None
    dialogue_listener = None
    dialogue_stt = None
    dialogue_expression = None
    dialogue_until = 0.0
    # Every brain supports dialogue now: bridges use their own planner, other
    # brains fall back to the local Hermes-like planner in PetBrain.build_dialog_loop.
    if args.dialogue_script or args.dialogue_stdin or args.mic:
        if args.dialogue_script:
            dialogue_listener = MockMicrophoneListener()
            for utterance in args.dialogue_script:
                dialogue_listener.push(
                    capture=AudioCapture(
                        audio_bytes=utterance.encode("utf-8"),
                        prompt_text=utterance,
                    )
                )
        elif args.dialogue_stdin:
            dialogue_listener = StdinMicrophoneListener()
            print("dialogue mode: type a line in the terminal and press enter")
        elif args.mic:
            dialogue_listener, dialogue_stt = build_voice_input(args.whisper_model)
            if isinstance(dialogue_listener, SoundDeviceMicrophoneListener):
                print("dialogue mode: speak near the microphone; pauses end a turn")
            else:
                print("dialogue mode: mic or whisper unavailable, type a line and press enter")
        if dialogue_listener is not None:
            dialogue_loop = brain.build_dialog_loop(
                listener=dialogue_listener,
                stt=dialogue_stt,
                tts=MacOSSayTextToSpeech(enabled=True) if args.voice else NullTextToSpeech(),
            )
    dialog_results: "queue.Queue" = queue.Queue()
    voice_snapshots = _VoiceInputSnapshotStore(machine)
    voice_session = None
    if dialogue_loop is not None:
        try:
            voice_session = _start_dialogue_session(
                dialogue_loop,
                voice_snapshots,
                dialog_results,
                config.get("voice", {}),
            )
        except Exception as error:
            print(f"warning: voice session unavailable ({error}); visual demo remains active")
    # A live VoiceSession owns the only TTS path. Camera-only mode keeps the
    # small compatibility player for gesture lines.
    voice_player = None if voice_session is not None else VoicePlayer(enabled=args.voice)
    frame_count = 0

    try:
        while True:
            ok, frame = cap.read()
            if not ok:
                print("error: failed to read frame from camera")
                return 1

            frame = cv2.flip(frame, 1)
            tracking = tracker.process(frame)
            now = time.monotonic()
            expression = machine.process(tracking.fired_event, now=now, tracking_confidence=tracking.tracking_confidence)
            voice_snapshots.update(machine, tracking)
            dialog_result_applied = False
            try:
                result = dialog_results.get_nowait()
                dialogue_expression = machine.apply_dialog_plan(result.plan, now=now)
                if tracking.fired_event is not None:
                    # Camera gestures are latency-sensitive and own physical
                    # motion.  A queued remote turn may still supply its fresh
                    # subtitle, but must not erase that one-frame reaction.
                    dialogue_expression = _preserve_gesture_ownership(
                        machine,
                        dialogue_expression,
                        expression,
                        event_name=tracking.fired_event.name,
                    )
                dialogue_until = now + 2.8
                dialog_result_applied = True
            except queue.Empty:
                pass
            interrupt_cached_dialogue = (
                tracking.fired_event is not None
                and not dialog_result_applied
                and dialogue_expression is not None
            )
            if interrupt_cached_dialogue:
                _interrupt_dialogue_speech(dialogue_loop)
            active_expression, dialogue_expression = _select_active_expression(
                expression,
                dialogue_expression,
                dialogue_until=dialogue_until,
                now=now,
                interrupt_dialogue=tracking.fired_event is not None and not dialog_result_applied,
                dialogue_speaking=_voice_session_is_speaking(voice_session),
            )
            if active_expression is expression:
                _speak_camera_line(dialogue_loop, voice_player, expression.voice_line)
            output = renderer.render(
                frame,
                tracking,
                active_expression,
                show_debug=args.debug,
                voice_status=_voice_status_text(voice_session),
            )

            if not args.no_window:
                cv2.imshow("HoloPet CV", output)
                key = cv2.waitKey(1) & 0xFF
                if key in (27, ord("q")):
                    break

            frame_count += 1
            if args.max_frames and frame_count >= args.max_frames:
                break
    finally:
        _stop_voice_session(voice_session)
        tracker.close()
        cap.release()
        cv2.destroyAllWindows()
    return 0


def main() -> int:
    args = parse_args()
    config = load_config()
    if args.probe_remote:
        return run_remote_probe(args.brain, args.memory_path, args.utterance)
    if args.self_test:
        return run_self_test(config, args.brain, args.memory_path, args.utterance)
    return run_camera_demo(args, config)


if __name__ == "__main__":
    raise SystemExit(main())
