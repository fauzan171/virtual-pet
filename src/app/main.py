"""Application entrypoint for the runnable HoloPet MVP."""

from __future__ import annotations

import argparse
import os
import time
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parents[2]
os.environ.setdefault("MPLCONFIGDIR", str(PROJECT_ROOT / ".cache" / "matplotlib"))
os.environ.setdefault("XDG_CACHE_HOME", str(PROJECT_ROOT / ".cache"))

import cv2
import yaml

from src.audio.listener import AudioCapture, MockMicrophoneListener, StdinMicrophoneListener
from src.audio.player import VoicePlayer
from src.audio.tts import NullTextToSpeech
from src.brain.hermes_bridge import HermesBridgeBrain
from src.brain.local_brain import LocalPetBrain
from src.brain.openai_brain import OpenAIPetBrain
from src.brain.remote_bridge import RemoteBridgeBrain
from src.core.models import InteractionEvent
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


def open_camera(index: int, config: dict) -> cv2.VideoCapture:
    cap = cv2.VideoCapture(index)
    cap.set(cv2.CAP_PROP_FRAME_WIDTH, config["camera"]["width"])
    cap.set(cv2.CAP_PROP_FRAME_HEIGHT, config["camera"]["height"])
    cap.set(cv2.CAP_PROP_FPS, config["camera"]["fps_target"])
    return cap


def run_camera_demo(args: argparse.Namespace, config: dict) -> int:
    cap = open_camera(args.camera_index, config)
    if not cap.isOpened():
        print("error: camera could not be opened")
        return 1

    brain = build_brain(args.brain, args.memory_path)
    tracker = GestureTracker(config)
    machine = HoloPetStateMachine(config["cooldowns"], brain=brain)
    renderer = HoloPetRenderer(subtitle_y_offset=config["render"]["subtitle_y_offset"])
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
        if dialogue_listener is not None:
            dialogue_loop = brain.build_dialog_loop(listener=dialogue_listener, tts=NullTextToSpeech())
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
            if dialogue_loop is not None:
                result = dialogue_loop.capture_and_handle(context=machine._context(tracking_confidence=tracking.tracking_confidence), tracking=tracking)
                if result is not None:
                    dialogue_expression = machine.apply_dialog_plan(result.plan, now=now)
                    dialogue_until = now + 2.8
                    voice.speak(dialogue_expression.voice_line)
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
    if args.self_test:
        return run_self_test(config, args.brain, args.memory_path, args.utterance)
    return run_camera_demo(args, config)


if __name__ == "__main__":
    raise SystemExit(main())
