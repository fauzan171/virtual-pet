'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { motion, useMotionValue } from 'framer-motion';
import { createHandLandmarker, extractHandFrame } from '@/lib/hand-tracking';
import { drawStrokeSegment, redrawAll } from '@/lib/strokes';
import {
  CAMERA,
  BUTTON_DEBOUNCE_MS,
  CLEAR_CONFIRM_TIMEOUT_MS,
  GESTURE_HOLD_FRAMES,
  GESTURE_COOLDOWN_MS,
  INK,
  COLORS,
  STROKE_WIDTH,
  DWELL_CLICK_MS,
  HAND_LOST_GRACE_FRAMES,
  BUTTON_HIT_PAD,
} from '@/lib/constants';
import type { AppState, ButtonId, HandFrame, Stroke, ShapeId, ToolId } from '@/lib/types';
import DrawingCanvas, { type DrawingCanvasHandle } from './DrawingCanvas';
import HandCursor, { type CursorState } from './HandCursor';
import MainMenu from './MainMenu';
import StatusBanner from './StatusBanner';
import DebugPanel from './DebugPanel';
import CameraPreview from './CameraPreview';
import LoadingExperience from './LoadingExperience';
import ColorPicker from './ColorPicker';
import ShapePicker, { SHAPES } from './ShapePicker';
import { STYLES, type StyleKey } from '@/lib/prompt';
import { sound } from '@/lib/sound';
import { VoiceController, voiceSupported, type VoiceCommand } from '@/lib/voice';
import {
  effectiveCalibration,
  saveCalibration,
  computePinchThresholds,
  type CalibrationData,
} from '@/lib/calibration';
import { PINCH_ON, PINCH_OFF, PINCH_RELEASE_GRACE_FRAMES } from '@/lib/constants';
import CalibrationOverlay, { type CalibrationPhase } from './CalibrationOverlay';

export default function AirCanvas() {
  const [appState, setAppState] = useState<AppState>('INITIALIZING');
  const [banner, setBanner] = useState<string | null>(null);
  const [debugOn, setDebugOn] = useState(false);
  // Preview on by default so presenter can see themselves and orient the cursor; toggle with C
  const [cameraPreviewOn, setCameraPreviewOn] = useState(true);
  const [cameraStream, setCameraStream] = useState<MediaStream | null>(null);
  const [hoveredButton, setHoveredButton] = useState<ButtonId | null>(null);
  const [clearConfirming, setClearConfirming] = useState(false);
  const clearConfirmingRef = useRef(false);
  const [undoConfirming, setUndoConfirming] = useState(false);
  const undoConfirmingRef = useRef(false);
  const [strokeCount, setStrokeCount] = useState(0);
  const [fps, setFps] = useState(0);
  const [resultUrl, setResultUrl] = useState<string | null>(null);
  const [sketchUrl, setSketchUrl] = useState<string | null>(null);
  // Calibration
  const [calMode, setCalMode] = useState<CalibrationPhase | null>(null);
  const [calProgress, setCalProgress] = useState(0);
  const calModeRef = useRef<CalibrationPhase | null>(null);
  const calRef = useRef<CalibrationData>(effectiveCalibration());
  const calSamplesRef = useRef({
    minX: 1, maxX: 0, minY: 1, maxY: 0,
    startedAt: 0,
    pinchDists: [] as number[],
    pinchCycles: 0,
    wasPinching: false,
  });

  const [selectedStyle, setSelectedStyle] = useState<StyleKey | null>(null);
  const selectedStyleRef = useRef<StyleKey | null>(null);
  const [hoveredStyle, setHoveredStyle] = useState<StyleKey | null>(null);
  // Ink color — selected via the right-side palette; tints cursor dot + strokes
  const [inkColor, setInkColor] = useState<string>(INK);
  const inkColorRef = useRef<string>(INK);
  const [hoveredColor, setHoveredColor] = useState<string | null>(null);
  const [paletteOpen, setPaletteOpen] = useState(false);
  // Shape tool: picker overlay + currently armed shape (null = freehand pen)
  const [shapePickerOpen, setShapePickerOpen] = useState(false);
  const shapePickerOpenRef = useRef(false);
  const [activeShape, setActiveShape] = useState<ShapeId | null>(null);
  const activeShapeRef = useRef<ShapeId | null>(null);
  const [hoveredShape, setHoveredShape] = useState<ShapeId | null>(null);
  // Tool: pen or eraser (eraser = thick white stroke on white canvas)
  const [tool, setTool] = useState<ToolId>('pen');
  const toolRef = useRef<ToolId>('pen');
  // Main menu popup (5-finger gesture) — replaces the always-visible bars
  const [menuOpen, setMenuOpen] = useState(false);
  const menuOpenRef = useRef(false);
  const setMenuState = useCallback((open: boolean) => {
    menuOpenRef.current = open;
    setMenuOpen(open);
    if (open) {
      // A fresh menu — clear any armed confirmations from a previous one
      clearConfirmingRef.current = false;
      setClearConfirming(false);
      undoConfirmingRef.current = false;
      setUndoConfirming(false);
    }
  }, []);
  const toggleMenu = useCallback(() => {
    setMenuState(!menuOpenRef.current);
  }, [setMenuState]);

  const setPaletteState = useCallback((open: boolean) => {
    paletteOpenRef.current = open;
    setPaletteOpen(open);
  }, []);
  const togglePalette = useCallback(() => {
    setPaletteState(!paletteOpenRef.current);
  }, [setPaletteState]);
  const [isPinching, setIsPinching] = useState(false);
  const [debugFrame, setDebugFrame] = useState<HandFrame | null>(null);

  const videoRef = useRef<HTMLVideoElement>(null);
  const drawingRef = useRef<DrawingCanvasHandle>(null);
  const landmarkerRef = useRef<Awaited<ReturnType<typeof createHandLandmarker>> | null>(null);
  const rafRef = useRef(0);
  const prevFrameRef = useRef<HandFrame | null>(null);
  const stateRef = useRef<AppState>('INITIALIZING');
  const strokesRef = useRef<Stroke[]>([]);
  const currentStrokeRef = useRef<Stroke | null>(null);
  const lastDrawnIndexRef = useRef(0);
  const buttonRectsRef = useRef<Record<ButtonId, DOMRect | null>>({
    UNDO: null,
    CLEAR: null,
    GENERATE: null,
    CLOSE: null,
  });
  const lastClickRef = useRef<Record<ButtonId, number>>({ UNDO: 0, CLEAR: 0, GENERATE: 0, CLOSE: 0 });
  // Dwell-to-click state: which control the cursor is resting on, and since when
  const dwellRef = useRef<{ id: string | null; since: number }>({ id: null, since: 0 });
  // Frames of lost hand tracking tolerated before committing the open stroke
  const handLostFramesRef = useRef(0);
  // Frames the pinch has stayed released while a stroke is open
  const pinchReleasedFramesRef = useRef(0);
  const clearTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const undoTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const styleRectsRef = useRef<Partial<Record<StyleKey, DOMRect | null>>>({});
  const lastStyleClickRef = useRef(0);
  const colorRectsRef = useRef<Record<string, DOMRect | null>>({});
  const lastColorClickRef = useRef(0);
  // Two-finger gesture toggles the color palette
  const paletteOpenRef = useRef(false);
  // Multi-finger gestures (3 = shape picker, 4 = eraser, 5 = undo)
  const gestureFramesRef = useRef(0);
  const gestureCooldownRef = useRef(0);
  const lastGestureCountRef = useRef(0);
  const shapeRectsRef = useRef<Partial<Record<ShapeId, DOMRect | null>>>({});
  const lastShapeClickRef = useRef(0);
  const eraserWidthRef = useRef(STROKE_WIDTH * 6);

  // MotionValues — cursor position updates without React re-render
  const cursorX = useMotionValue(0);
  const cursorY = useMotionValue(0);

  const setState = useCallback((s: AppState) => {
    stateRef.current = s;
    setAppState(s);
  }, []);

  // ─── Actions ────────────────────────────────────────────────────────────────

  const executeUndo = useCallback(() => {
    strokesRef.current.pop();
    drawingRef.current?.redraw(strokesRef.current);
    setStrokeCount(strokesRef.current.length);
    undoConfirmingRef.current = false;
    setUndoConfirming(false);
  }, []);

  /**
   * Two-step undo, same pattern as CLEAR: first press arms it, second press
   * executes. A hand brushing past the button while drawing can't wipe the
   * last stroke by accident. `skipConfirm` is used by the keyboard failsafe.
   */
  const triggerUndo = useCallback((skipConfirm = false) => {
    if (stateRef.current !== 'DRAWING') return;
    if (skipConfirm || undoConfirmingRef.current) {
      executeUndo();
      return;
    }
    undoConfirmingRef.current = true;
    setUndoConfirming(true);
    if (undoTimerRef.current) clearTimeout(undoTimerRef.current);
    undoTimerRef.current = setTimeout(() => {
      undoConfirmingRef.current = false;
      setUndoConfirming(false);
    }, CLEAR_CONFIRM_TIMEOUT_MS);
  }, [executeUndo]);

  const executeClear = useCallback(() => {
    strokesRef.current = [];
    currentStrokeRef.current = null;
    drawingRef.current?.clear();
    setStrokeCount(0);
    setClearConfirming(false);
    clearConfirmingRef.current = false;
  }, []);

  // ⚠ Reads clearConfirmingRef, not the state — the rAF loop captured this
  // callback once at mount, so reading React state here would be permanently
  // stale and the second "confirm" press would never actually clear.
  const triggerClear = useCallback((skipConfirm = false) => {
    if (stateRef.current !== 'DRAWING') return;
    if (skipConfirm || clearConfirmingRef.current) {
      executeClear();
      return;
    }
    clearConfirmingRef.current = true;
    setClearConfirming(true);
    if (clearTimerRef.current) clearTimeout(clearTimerRef.current);
    clearTimerRef.current = setTimeout(() => {
      clearConfirmingRef.current = false;
      setClearConfirming(false);
    }, CLEAR_CONFIRM_TIMEOUT_MS);
  }, [executeClear]);

  const triggerGenerate = useCallback(async (subject?: string) => {
    if (stateRef.current === 'GENERATING' || stateRef.current === 'CAPTURE') return;
    if (strokesRef.current.length === 0) return;
    setState('CAPTURE');
    setBanner('SKETCH CAPTURED ✓');
    sound.captured();
    try {
      const blob = await drawingRef.current!.exportPng();
      setSketchUrl(URL.createObjectURL(blob));
      setState('GENERATING');
      sound.generateStart();
      const form = new FormData();
      form.append('image', blob, 'sketch.png');
      if (selectedStyleRef.current) form.append('style', selectedStyleRef.current);
      // Subject spoken by the presenter ("generate a dragon") — feeds the
      // fallback engine when no img2img provider key is configured.
      if (subject) form.append('subject', subject);
      const res = await fetch('/api/generate', { method: 'POST', body: form });
      if (!res.ok) throw new Error('API error');
      const data = await res.json();
      setResultUrl(data.imageUrl);
      // Hold on the reveal ~1.4s after the asset arrives (PRD §26)
      await new Promise((r) => setTimeout(r, 1400));
      sound.reveal();
      setState('RESULT');
      setBanner(null);
    } catch {
      // Sketch preserved on failure
      setState('DRAWING');
      setBanner('GENERATION FAILED — SKETCH PRESERVED');
      setTimeout(() => setBanner(null), 3000);
    }
  }, [setState]);

  // Tool setters keep their paired refs in sync — used from both the rAF
  // loop (via refs) and actions like triggerReset.
  const setShapeState = useCallback((shape: ShapeId | null) => {
    activeShapeRef.current = shape;
    setActiveShape(shape);
  }, []);

  const setShapePickerState = useCallback((open: boolean) => {
    shapePickerOpenRef.current = open;
    setShapePickerOpen(open);
  }, []);

  const setToolState = useCallback((t: ToolId) => {
    toolRef.current = t;
    setTool(t);
  }, []);

  const triggerReset = useCallback(() => {
    strokesRef.current = [];
    currentStrokeRef.current = null;
    drawingRef.current?.clear();
    setStrokeCount(0);
    setResultUrl(null);
    if (sketchUrl) URL.revokeObjectURL(sketchUrl);
    setSketchUrl(null);
    setSelectedStyle(null);
    selectedStyleRef.current = null;
    setInkColor(INK);
    inkColorRef.current = INK;
    // Tool state back to defaults: pen, freehand, overlays closed.
    // Reuse the setters that also sync their refs — direct ref writes here
    // violate react-hooks/immutability (ref captured by another hook).
    setToolState('pen');
    setShapeState(null);
    setShapePickerState(false);
    setPaletteState(false);
    setMenuState(false);
    setClearConfirming(false);
    clearConfirmingRef.current = false;
    setState('READY');
    setBanner(null);
  }, [setState, sketchUrl, setToolState, setShapeState, setShapePickerState, setPaletteState, setMenuState]);

  const toggleFullscreen = useCallback(() => {
    if (!document.fullscreenElement) document.documentElement.requestFullscreen();
    else document.exitFullscreen();
  }, []);

  const startCalibration = useCallback(() => {
    calSamplesRef.current = {
      minX: 1, maxX: 0, minY: 1, maxY: 0,
      startedAt: Date.now(),
      pinchDists: [],
      pinchCycles: 0,
      wasPinching: false,
    };
    calModeRef.current = 'RANGE';
    setCalMode('RANGE');
    setCalProgress(0);
  }, []);

  const finishCalibration = useCallback(() => {
    const s = calSamplesRef.current;
    if (s.maxX > s.minX && s.maxY > s.minY) {
      const pinch = s.pinchDists.length >= 4
        ? computePinchThresholds(s.pinchDists)
        : { on: PINCH_ON, off: PINCH_OFF };
      const data: CalibrationData = {
        minX: s.minX, maxX: s.maxX, minY: s.minY, maxY: s.maxY,
        // Hysteresis gap must be proportional now that thresholds are
        // hand-size ratios, not raw distances
        pinchOn: pinch.on, pinchOff: Math.max(pinch.off, pinch.on * 1.3),
      };
      calRef.current = data;
      saveCalibration(data);
    }
    calModeRef.current = null;
    setCalMode(null);
  }, []);

  const cancelCalibration = useCallback(() => {
    calModeRef.current = null;
    setCalMode(null);
  }, []);

  // ─── Button hit testing ─────────────────────────────────────────────────────

  const hitTest = useCallback((x: number, y: number): ButtonId | null => {
    for (const id of ['UNDO', 'CLEAR', 'GENERATE', 'CLOSE'] as ButtonId[]) {
      const rect = buttonRectsRef.current[id];
      if (
        rect &&
        x >= rect.left - BUTTON_HIT_PAD &&
        x <= rect.right + BUTTON_HIT_PAD &&
        y >= rect.top - BUTTON_HIT_PAD &&
        y <= rect.bottom + BUTTON_HIT_PAD
      ) {
        return id;
      }
    }
    return null;
  }, []);

  const hitTestStyle = useCallback((x: number, y: number): StyleKey | null => {
    for (const key of Object.keys(STYLES) as StyleKey[]) {
      const rect = styleRectsRef.current[key];
      if (
        rect &&
        x >= rect.left - BUTTON_HIT_PAD &&
        x <= rect.right + BUTTON_HIT_PAD &&
        y >= rect.top - BUTTON_HIT_PAD &&
        y <= rect.bottom + BUTTON_HIT_PAD
      ) {
        return key;
      }
    }
    return null;
  }, []);

  const hitTestColor = useCallback((x: number, y: number): string | null => {
    for (const color of COLORS) {
      const rect = colorRectsRef.current[color];
      if (
        rect &&
        x >= rect.left - BUTTON_HIT_PAD &&
        x <= rect.right + BUTTON_HIT_PAD &&
        y >= rect.top - BUTTON_HIT_PAD &&
        y <= rect.bottom + BUTTON_HIT_PAD
      ) {
        return color;
      }
    }
    return null;
  }, []);

  const hitTestShape = useCallback((x: number, y: number): ShapeId | null => {
    for (const shape of SHAPES) {
      const rect = shapeRectsRef.current[shape];
      if (
        rect &&
        x >= rect.left - BUTTON_HIT_PAD &&
        x <= rect.right + BUTTON_HIT_PAD &&
        y >= rect.top - BUTTON_HIT_PAD &&
        y <= rect.bottom + BUTTON_HIT_PAD
      ) {
        return shape;
      }
    }
    return null;
  }, []);

  const handlePinchClick = useCallback(
    (x: number, y: number) => {
      const now = Date.now();
      const shape = hitTestShape(x, y);
      if (shape) {
        if (now - lastShapeClickRef.current < BUTTON_DEBOUNCE_MS) return;
        lastShapeClickRef.current = now;
        sound.click();
        setShapeState(shape);
        setToolState('pen');
        setShapePickerState(false);
        return;
      }
      const color = hitTestColor(x, y);
      if (color) {
        if (now - lastColorClickRef.current < BUTTON_DEBOUNCE_MS) return;
        lastColorClickRef.current = now;
        sound.click();
        setInkColor(color);
        inkColorRef.current = color;
        // Color chosen — dismiss the palette so drawing resumes
        setPaletteState(false);
        return;
      }
      const style = hitTestStyle(x, y);
      if (style) {
        if (now - lastStyleClickRef.current < BUTTON_DEBOUNCE_MS) return;
        lastStyleClickRef.current = now;
        setSelectedStyle(style);
        selectedStyleRef.current = style;
        return;
      }
      const id = hitTest(x, y);
      if (!id) return;
      if (now - lastClickRef.current[id] < BUTTON_DEBOUNCE_MS) return;
      lastClickRef.current[id] = now;
      sound.click();
      if (id === 'UNDO') triggerUndo();
      else if (id === 'CLEAR') triggerClear();
      else if (id === 'GENERATE') triggerGenerate();
      else if (id === 'CLOSE') toggleMenu();
    },
    [hitTest, hitTestStyle, hitTestColor, hitTestShape, triggerUndo, triggerClear, triggerGenerate, toggleMenu, setPaletteState, setShapeState, setShapePickerState, setToolState]
  );

  // ─── Voice command state (declared before keyboard effect uses setVoiceOn) ──

  const [voiceOn, setVoiceOn] = useState(false);
  const [voiceListening, setVoiceListening] = useState(false);
  // useState initializer = one stable controller instance, no ref mutation
  const [voiceCtrl] = useState(() => new VoiceController());
  // Latest actions via ref so the voice handler never goes stale
  const actionsRef = useRef({ triggerGenerate, triggerUndo, triggerClear, triggerReset });
  useEffect(() => {
    actionsRef.current = { triggerGenerate, triggerUndo, triggerClear, triggerReset };
  }, [triggerGenerate, triggerUndo, triggerClear, triggerReset]);

  // ─── Keyboard failsafes ─────────────────────────────────────────────────────

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      switch (e.key.toLowerCase()) {
        case 'g': triggerGenerate(); break;
        case 'z': triggerUndo(true); break;
        case 'x': triggerClear(true); break;
        case 'r': triggerReset(); break;
        case 'c': setCameraPreviewOn(v => !v); break;
        case 'd': setDebugOn(v => !v); break;
        case 'f': toggleFullscreen(); break;
        case 's': sound.toggle(); break;
        case 'v': togglePalette(); break;
        case 'm': setVoiceOn(v => !v); break;
        case 'b':
          if (calModeRef.current) cancelCalibration();
          else if (stateRef.current === 'READY' || stateRef.current === 'DRAWING') startCalibration();
          break;
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [triggerGenerate, triggerUndo, triggerClear, triggerReset, toggleFullscreen, startCalibration, cancelCalibration, togglePalette]);

  // ─── Voice commands ─────────────────────────────────────────────────────────

  useEffect(() => {
    const ctrl = voiceCtrl;
    if (voiceOn && voiceSupported()) {
      ctrl.start({
        onCommand: (cmd: VoiceCommand) => {
          const a = actionsRef.current;
          sound.click();
          switch (cmd.action) {
            case 'generate':
              a.triggerGenerate(cmd.subject);
              setBanner(cmd.subject ? `GENERATING "${cmd.subject.toUpperCase()}"` : 'VOICE COMMAND ✓');
              break;
            case 'undo': a.triggerUndo(true); break;
            case 'clear': a.triggerClear(); break;
            case 'confirm': a.triggerClear(); break;
            case 'reset': a.triggerReset(); break;
          }
        },
        onStatus: setVoiceListening,
        // Read fresh each result so "confirm" only works while CLEAR is armed
        isClearConfirming: () => clearConfirmingRef.current,
      });
    } else {
      ctrl.stop();
    }
    return () => ctrl.stop();
  }, [voiceOn, voiceCtrl]);

  // ─── Main loop ─────────────────────────────────────────────────────────────

  useEffect(() => {
    let cancelled = false;
    let fpsCount = 0;
    let lastFpsTime = performance.now();

    async function init() {
      setState('INITIALIZING');
      const landmarker = await createHandLandmarker();
      if (cancelled) { landmarker.close(); return; }
      landmarkerRef.current = landmarker;

      setState('CAMERA_PERMISSION');
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { width: CAMERA.width, height: CAMERA.height, facingMode: 'user' },
        });
        if (cancelled) { stream.getTracks().forEach(t => t.stop()); return; }
        videoRef.current!.srcObject = stream;
        setCameraStream(stream);
        await videoRef.current!.play();
      } catch {
        // Stay in CAMERA_PERMISSION, banner already shows the message
        return;
      }

      setState('READY');
      rafRef.current = requestAnimationFrame(loop);
    }

    function loop() {
      if (cancelled) return;
      const video = videoRef.current;
      const landmarker = landmarkerRef.current;
      const drawing = drawingRef.current;

      if (!video || !landmarker || video.readyState < 2 || !drawing) {
        rafRef.current = requestAnimationFrame(loop);
        return;
      }

      const [cw, ch] = drawing.size();
      const canvasRect = drawing.rect();
      const result = landmarker.detectForVideo(video, performance.now());
      const frame = extractHandFrame(result, cw, ch, prevFrameRef.current, calRef.current);
      const prev = prevFrameRef.current;
      prevFrameRef.current = frame;

      // frame.cursor is canvas-local; viewport coords for cursor display + button hit-testing
      const vx = frame.cursor.x + canvasRect.left;
      const vy = frame.cursor.y + canvasRect.top;

      // Calibration sampling (B key) — separate from normal drawing flow
      const calPhase = calModeRef.current;
      if (calPhase && frame.detected) {
        const s = calSamplesRef.current;
        if (calPhase === 'RANGE') {
          s.minX = Math.min(s.minX, frame.rawIndex.x);
          s.maxX = Math.max(s.maxX, frame.rawIndex.x);
          s.minY = Math.min(s.minY, frame.rawIndex.y);
          s.maxY = Math.max(s.maxY, frame.rawIndex.y);
          const elapsed = Date.now() - s.startedAt;
          setCalProgress(Math.min(elapsed / 8000, 1));
          if (elapsed >= 8000) {
            calModeRef.current = 'PINCH';
            setCalMode('PINCH');
            setCalProgress(0);
          }
        } else {
          s.pinchDists.push(frame.pinchDist);
          if (frame.pinching && !s.wasPinching) s.pinchCycles++;
          s.wasPinching = frame.pinching;
          setCalProgress(Math.min(s.pinchCycles / 5, 1));
          if (s.pinchCycles >= 5) finishCalibration();
        }
      }

      cursorX.set(vx);
      cursorY.set(vy);

      // Finger-count gesture menu (thumb excluded, it is the pinch finger):
      //   2 (index+middle) = color palette, 3 = shape picker, 4 = eraser
      //   toggle, 5 (open palm) = main menu popup.
      // Hold for GESTURE_HOLD_FRAMES to fire; cooldown stops re-trigger while
      // the hand is still in the pose.
      if (frame.detected && stateRef.current === 'DRAWING' && !calModeRef.current) {
        // Only count 2 when it is specifically index+middle (twoFingers);
        // any other 2-finger combo is ambiguous and should not trigger.
        const count = frame.fingerCount === 2 ? (frame.twoFingers ? 2 : 0) : frame.fingerCount;
        if (count >= 2 && count <= 5) {
          if (count === lastGestureCountRef.current) {
            gestureFramesRef.current++;
          } else {
            lastGestureCountRef.current = count;
            gestureFramesRef.current = 1;
          }
          if (
            gestureFramesRef.current === GESTURE_HOLD_FRAMES &&
            Date.now() > gestureCooldownRef.current
          ) {
            gestureCooldownRef.current = Date.now() + GESTURE_COOLDOWN_MS;
            sound.click();
            if (count === 2) {
              togglePalette();
            } else if (count === 3) {
              setShapePickerState(!shapePickerOpenRef.current);
            } else if (count === 4) {
              const next: ToolId = toolRef.current === 'eraser' ? 'pen' : 'eraser';
              setToolState(next);
              setShapeState(null);
              setBanner(next === 'eraser' ? 'ERASER ON' : 'PEN ON');
            } else if (count === 5) {
              toggleMenu();
            }
          }
        } else {
          gestureFramesRef.current = 0;
          lastGestureCountRef.current = 0;
        }
      } else {
        gestureFramesRef.current = 0;
        lastGestureCountRef.current = 0;
      }

      // FPS + debug snapshot (1Hz to avoid per-frame re-renders)
      fpsCount++;
      const now = performance.now();
      if (now - lastFpsTime >= 1000) {
        setFps(fpsCount * (1000 / (now - lastFpsTime)));
        setDebugFrame(frame);
        fpsCount = 0;
        lastFpsTime = now;
      }
      setIsPinching(frame.pinching);

      // State transition: hand appears
      if (stateRef.current === 'READY' && frame.detected) {
        setState('DRAWING');
        setBanner(null);
        sound.trackingOn();
      }
      // Grace period: tolerate brief detection dropouts so the stroke (and
      // paint mode) doesn't flicker off for a lost frame or two.
      handLostFramesRef.current = frame.detected ? 0 : handLostFramesRef.current + 1;
      const handLost = handLostFramesRef.current > HAND_LOST_GRACE_FRAMES;
      if (stateRef.current === 'DRAWING' && handLost && currentStrokeRef.current) {
        // Hand truly lost mid-drawing — finish current stroke, stay in DRAWING
        strokesRef.current.push(currentStrokeRef.current);
        currentStrokeRef.current = null;
        setStrokeCount(strokesRef.current.length);
      }

      // Suppress drawing during calibration
      if (calModeRef.current) {
        rafRef.current = requestAnimationFrame(loop);
        return;
      }

      // Suppress drawing while the cursor is over a virtual control
      const overControl =
        hitTest(vx, vy) !== null ||
        hitTestStyle(vx, vy) !== null ||
        hitTestColor(vx, vy) !== null ||
        hitTestShape(vx, vy) !== null;

      // Drawing (only while hand is reliably present and overlays closed)
      if (
        stateRef.current === 'DRAWING' &&
        frame.detected &&
        !handLost &&
        !overControl &&
        !menuOpenRef.current &&
        !paletteOpenRef.current &&
        !shapePickerOpenRef.current
      ) {
        const ctx = drawing.getCtx();
        if (frame.pinching) {
          pinchReleasedFramesRef.current = 0;
          if (!currentStrokeRef.current) {
            currentStrokeRef.current = {
              points: [frame.cursor],
              width: toolRef.current === 'eraser' ? eraserWidthRef.current : STROKE_WIDTH,
              // Eraser paints white — canvas background is white
              color: toolRef.current === 'eraser' ? '#ffffff' : inkColorRef.current,
              shape: toolRef.current === 'eraser' ? undefined : (activeShapeRef.current ?? undefined),
              tool: toolRef.current,
            };
            lastDrawnIndexRef.current = 0;
          } else {
            currentStrokeRef.current.points.push(frame.cursor);
            if (ctx) {
              if (currentStrokeRef.current.shape) {
                // ponytail: full redraw per frame for live shape preview;
                // swap to an offscreen ghost layer if stroke count grows large
                const [cw, ch] = drawing.size();
                redrawAll(ctx, [...strokesRef.current, currentStrokeRef.current], cw, ch);
              } else {
                drawStrokeSegment(ctx, currentStrokeRef.current, lastDrawnIndexRef.current);
              }
            }
            lastDrawnIndexRef.current = currentStrokeRef.current.points.length - 1;
          }
        } else if (currentStrokeRef.current) {
          // Grace period: brief pinch wobbles during fast drawing must not
          // split one line into multiple strokes — only commit after the
          // pinch stays released for PINCH_RELEASE_GRACE_FRAMES frames.
          pinchReleasedFramesRef.current++;
          if (pinchReleasedFramesRef.current > PINCH_RELEASE_GRACE_FRAMES) {
            strokesRef.current.push(currentStrokeRef.current);
            currentStrokeRef.current = null;
            pinchReleasedFramesRef.current = 0;
            setStrokeCount(strokesRef.current.length);
          }
        }
      } else if (frame.detected && !handLost && currentStrokeRef.current) {
        // Hand present but cursor moved over a control — commit the stroke.
        // (Hand-lost case is handled above after the grace period expires.)
        strokesRef.current.push(currentStrokeRef.current);
        currentStrokeRef.current = null;
        setStrokeCount(strokesRef.current.length);
      }
      // While hand is briefly lost (within the grace window), the open stroke
      // is NOT committed — drawing resumes the same stroke when the hand
      // returns, instead of starting a new one mid-line.

      // Button hover + click (viewport coords vs DOM rects)
      if (frame.detected) {
        setHoveredButton(hitTest(vx, vy));
        setHoveredStyle(hitTestStyle(vx, vy));
        setHoveredColor(hitTestColor(vx, vy));
        setHoveredShape(hitTestShape(vx, vy));
        // Rising edge only — prevents re-trigger while holding pinch to draw
        if (frame.pinching && !prev?.pinching) {
          handlePinchClick(vx, vy);
        }

        // Dwell-to-click: rest the cursor on a control to activate it.
        // Easier on stage than a precise pinch on a moving target.
        const dwellId = hitTest(vx, vy) ?? hitTestStyle(vx, vy) ?? hitTestColor(vx, vy) ?? hitTestShape(vx, vy);
        if (dwellId) {
          if (dwellRef.current.id !== dwellId) {
            dwellRef.current = { id: dwellId, since: Date.now() };
          } else if (Date.now() - dwellRef.current.since >= DWELL_CLICK_MS) {
            // Infinity sentinel: won't re-fire until the cursor leaves and returns
            dwellRef.current = { id: dwellId, since: Number.POSITIVE_INFINITY };
            handlePinchClick(vx, vy);
          }
        } else {
          dwellRef.current = { id: null, since: 0 };
        }
      } else {
        dwellRef.current = { id: null, since: 0 };
      }

      rafRef.current = requestAnimationFrame(loop);
    }

    init();
    const video = videoRef.current;
    return () => {
      cancelled = true;
      cancelAnimationFrame(rafRef.current);
      (video?.srcObject as MediaStream | null)?.getTracks().forEach((t) => t.stop());
      landmarkerRef.current?.close();
    };
  }, [setState, cursorX, cursorY, hitTest, hitTestStyle, hitTestColor, hitTestShape, handlePinchClick, togglePalette, setShapePickerState, setToolState, setShapeState, toggleMenu, finishCalibration]);

  // ─── Cursor visual state ────────────────────────────────────────────────────

  const cursorState: CursorState =
    hoveredButton || hoveredStyle || hoveredColor ? 'hover' : isPinching ? 'pinch' : 'normal';

  // ─── Render ─────────────────────────────────────────────────────────────────

  return (
    <div className="relative h-screen w-screen overflow-hidden bg-[#050510]">
      {/* Hidden video element for MediaPipe */}
      <video ref={videoRef} autoPlay playsInline muted className="hidden" />

      {/* Drawing canvas */}
      <DrawingCanvas ref={drawingRef} />

      {/* Controls — everything hidden except the tool badge; menu is a
          5-finger popup so the canvas stays free of buttons while drawing */}
      {appState === 'DRAWING' && (
        <>
          {paletteOpen && (
            <ColorPicker
              selected={inkColor}
              hovered={hoveredColor}
              registerRect={(color, rect) => { colorRectsRef.current[color] = rect; }}
            />
          )}
          {shapePickerOpen && (
            <ShapePicker
              selected={activeShape}
              hovered={hoveredShape}
              registerRect={(shape, rect) => { shapeRectsRef.current[shape] = rect; }}
            />
          )}
          {/* Active tool badge — shows eraser mode or armed shape */}
          {(tool === 'eraser' || activeShape) && (
            <div className="pointer-events-none absolute left-1/2 top-6 z-30 -translate-x-1/2 rounded-full bg-black/60 px-5 py-2 text-sm font-bold tracking-[0.25em] text-white ring-1 ring-white/20">
              {tool === 'eraser' ? 'ERASER ✦ 4 FINGERS TO SWITCH BACK' : `${activeShape?.toUpperCase()} ✦ 4 FINGERS FOR ERASER`}
            </div>
          )}
          {menuOpen && (
            <MainMenu
              hoveredButton={hoveredButton}
              hoveredStyle={hoveredStyle}
              selectedStyle={selectedStyle}
              clearConfirming={clearConfirming}
              undoConfirming={undoConfirming}
              generateDisabled={strokeCount === 0}
              onUndo={() => triggerUndo()}
              onClear={() => triggerClear()}
              onGenerate={() => {
                setMenuState(false);
                triggerGenerate();
              }}
              onClose={() => setMenuState(false)}
              registerRect={(id, rect) => { buttonRectsRef.current[id] = rect; }}
              registerStyleRect={(key, rect) => { styleRectsRef.current[key] = rect; }}
            />
          )}
        </>
      )}

      {/* Result screen */}
      {appState === 'RESULT' && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.9 }}
          className="absolute inset-0 z-20 flex flex-col items-center justify-center gap-10 bg-[#050510]"
        >
          <h2 className="text-5xl font-bold tracking-widest text-white">FROM IMAGINATION TO CREATION</h2>
          <div className="flex items-center gap-16">
            <div className="text-center">
              <p className="mb-3 text-sm tracking-[0.3em] text-slate-400">YOUR SKETCH</p>
              {sketchUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={sketchUrl} alt="Sketch" className="h-[270px] w-[360px] rounded-xl object-contain" />
              ) : (
                <div className="h-[270px] w-[360px] rounded-xl bg-white/5" />
              )}
            </div>
            <div className="text-4xl text-slate-600">→</div>
            <div className="text-center">
              <p className="mb-3 text-sm tracking-[0.3em] text-cyan-300">AI CREATION</p>
              {resultUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={resultUrl} alt="AI generated" className="h-[270px] w-[360px] rounded-xl object-cover" />
              ) : (
                <div className="h-[270px] w-[360px] rounded-xl bg-white/5" />
              )}
            </div>
          </div>
          <button
            onClick={triggerReset}
            className="mt-4 rounded-2xl bg-white/10 px-12 py-5 text-2xl font-bold tracking-widest text-white ring-1 ring-white/20 transition hover:bg-white/20"
          >
            START AGAIN
          </button>
        </motion.div>
      )}

      {/* Staged loading during capture + generation */}
      {(appState === 'CAPTURE' || appState === 'GENERATING') && <LoadingExperience />}

      {/* Calibration mode */}
      {calMode && (
        <CalibrationOverlay phase={calMode} progress={calProgress} onCancel={cancelCalibration} />
      )}

      {/* Cursor */}
      <HandCursor x={cursorX} y={cursorY} state={cursorState} color={inkColor} />

      {/* Status */}
      <StatusBanner state={appState} custom={banner} />

      {/* Debug */}
      {debugOn && (
        <DebugPanel fps={fps} frame={debugFrame} state={appState} strokeCount={strokeCount} />
      )}

      {/* Camera preview pip */}
      {cameraPreviewOn && appState !== 'RESULT' && <CameraPreview stream={cameraStream} />}

      {/* Voice status badge */}
      {voiceOn && (
        <div className="pointer-events-none absolute right-5 top-5 z-40 flex items-center gap-2 rounded-full bg-black/60 px-4 py-2 text-sm font-semibold tracking-wider text-white ring-1 ring-white/20">
          <span
            className={`h-2.5 w-2.5 rounded-full ${voiceListening ? 'animate-pulse bg-emerald-400' : 'bg-red-400'}`}
          />
          {voiceListening ? 'LISTENING' : 'MIC OFF'}
        </div>
      )}
    </div>
  );
}
