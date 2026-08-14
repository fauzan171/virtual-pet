"""Application entrypoint for the runnable HoloPet MVP."""

from __future__ import annotations

import argparse
import os
import queue
import threading
import time
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parents[2]
os.environ.setdefault("MPLCONFIGDIR", str(PROJECT_ROOT / ".cache" / "matplotlib"))
os.environ.setdefault("XDG_CACHE_HOME", str(PROJECT_ROOT / ".cache"))

import cv2
import yaml

from src.audio.listener import AudioCapture, MockMicrophoneListener, SoundDeviceMicrophoneListener, StdinMicrophoneListener
from src.audio.player import VoicePlayer
from src.audio.tts import MacOSSayTextToSpeech, NullTextToSpeech
from src.brain.hermes_bridge import HermesBridgeBrain
from src.brain.local_brain import LocalPetBrain
from src.brain.openai_brain import OpenAIPetBrain
from src.brain.remote_bridge import RemoteBridgeBrain
from src.core.models import InteractionEvent, PetContext
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
    if isinstance(brain, (HermesBridgeBrain, RemoteBridgeBrain)):
        context = machine._context(tracking_confidence=1.0)
        print("   agent_chat ->", brain.preview_dialog(context, "Namaku Jadi"))
        print("   agent_chat ->", brain.preview_dialog(context, "ke bahu kanan"))
        dialog_loop = brain.build_dialog_loop(tts=NullTextToSpeech())
        scripted = utterances or ["namaku siapa", "ke bahu kiri"]
        for result in dialog_loop.run_self_test(context=context, utterances=scripted):
            print(f"dialog_self -> {result.utterance} => {result.plan.reply} | src={result.plan.response_source} | {result.memory_summary}")
    print("self-test complete")
    return 0


def run_remote_probe(brain_name: str, memory_path: str, utterances: list[str]) -> int:
    brain = build_brain(brain_name, memory_path)
    if not isinstance(brain, (HermesBridgeBrain, RemoteBridgeBrain)):
        print("error: probe mode requires a planner-backed brain such as remote or hermes")
        return 1
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
    """Create a microphone listener plus local Whisper STT; either may fail gracefully."""
    try:
        listener = SoundDeviceMicrophoneListener()
    except Exception as error:
        print(f"warning: microphone unavailable ({error})")
        return None, None
    try:
        from src.audio.stt import WhisperSpeechToText

        stt = WhisperSpeechToText(model_name=whisper_model_name)
    except Exception as error:
        print(f"warning: whisper unavailable ({error}); mic input will not be transcribed")
        stt = None
    return listener, stt


def open_camera(index: int, config: dict) -> cv2.VideoCapture:
    cap = cv2.VideoCapture(index)
    cap.set(cv2.CAP_PROP_FRAME_WIDTH, config["camera"]["width"])
    cap.set(cv2.CAP_PROP_FRAME_HEIGHT, config["camera"]["height"])
    cap.set(cv2.CAP_PROP_FPS, config["camera"]["fps_target"])
    return cap


def _dialog_worker(loop, machine, tracking_holder: dict, results: "queue.Queue") -> None:
    while True:
        tracking = tracking_holder.get("tracking")
        confidence = tracking.tracking_confidence if tracking is not None else 1.0
        result = loop.capture_and_handle(context=machine._context(tracking_confidence=confidence), tracking=tracking)
        if result is None:
            time.sleep(0.05)
            continue
        results.put(result)


def run_camera_demo(args: argparse.Namespace, config: dict) -> int:
    cap = open_camera(args.camera_index, config)
    if not cap.isOpened():
        print("error: camera could not be opened")
        return 1

    brain = build_brain(args.brain, args.memory_path)
    tracker = GestureTracker(config)
    machine = HoloPetStateMachine(config["cooldowns"], brain=brain)
    skin = args.skin or config["render"].get("skin", "fox")
    renderer = HoloPetRenderer(subtitle_y_offset=config["render"]["subtitle_y_offset"], skin=skin)
    voice = VoicePlayer(enabled=args.voice)
    dialogue_loop = None
    dialogue_listener = None
    dialogue_expression = None
    dialogue_until = 0.0
    if isinstance(brain, (HermesBridgeBrain, RemoteBridgeBrain)):
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
            dialogue_listener, stt = build_voice_input(args.whisper_model)
            if dialogue_listener is not None:
                print("dialogue mode: speak near the microphone; pauses end a turn")
                dialogue_loop = brain.build_dialog_loop(
                    listener=dialogue_listener,
                    stt=stt,
                    tts=MacOSSayTextToSpeech(enabled=True) if args.voice else NullTextToSpeech(),
                )
            else:
                dialogue_listener = StdinMicrophoneListener()
                print("dialogue mode: mic or whisper unavailable, type a line and press enter")
        if dialogue_loop is None and dialogue_listener is not None:
            # ponytail: dialog replies were silent with --voice because the TTS
            # default is enabled=False; keep both paths in sync if one changes.
            dialogue_loop = brain.build_dialog_loop(
                listener=dialogue_listener,
                tts=MacOSSayTextToSpeech(enabled=True) if args.voice else NullTextToSpeech(),
            )
    # ponytail: one worker thread keeps the camera loop free when remote is
    # slow; upgrade to a request pool only if multiple mics arrive.
    dialog_results: "queue.Queue" = queue.Queue()
    dialog_tracking: dict = {"tracking": None}
    if dialogue_loop is not None:
        threading.Thread(
            target=_dialog_worker,
            args=(dialogue_loop, machine, dialog_tracking, dialog_results),
            daemon=True,
        ).start()
    frame_count = 0

    try:
        while True:
            ok, frame = cap.read()
            if not ok:
                print("error: failed to read frame from camera")
                return 1

            frame = cv2.flip(frame, 1)
            tracking = tracker.process(frame)
            dialog_tracking["tracking"] = tracking
            now = time.monotonic()
            expression = machine.process(tracking.fired_event, now=now, tracking_confidence=tracking.tracking_confidence)
            try:
                result = dialog_results.get_nowait()
                dialogue_expression = machine.apply_dialog_plan(result.plan, now=now)
                dialogue_until = now + 2.8
                voice.speak(dialogue_expression.voice_line)
            except queue.Empty:
                pass
            active_expression = expression
            if dialogue_expression is not None and now <= dialogue_until:
                active_expression = dialogue_expression
            elif dialogue_expression is not None and now > dialogue_until:
                dialogue_expression = None
            if active_expression is expression:
                voice.speak(expression.voice_line)
            output = renderer.render(frame, tracking, active_expression, show_debug=args.debug)

            if not args.no_window:
                cv2.imshow("HoloPet CV", output)
                key = cv2.waitKey(1) & 0xFF
                if key in (27, ord("q")):
                    break

            frame_count += 1
            if args.max_frames and frame_count >= args.max_frames:
                break
    finally:
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
