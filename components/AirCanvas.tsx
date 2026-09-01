'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { motion, useMotionValue } from 'framer-motion';
import { createHandLandmarker, extractHandFrame, resetHandSmoothing } from '@/lib/hand-tracking';
import {
  CAMERA,
  BUTTON_DEBOUNCE_MS,
  CLEAR_CONFIRM_TIMEOUT_MS,
  INK,
  COLORS,
  STROKE_WIDTH,
  MIN_BRUSH_SIZE,
  MAX_BRUSH_SIZE,
  HAND_LOST_GRACE_FRAMES,
  MAX_REACQUIRE_JUMP_PX,
  BUTTON_HIT_PAD,
  DWELL_SELECT_MS,
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
import { captureVoicePrompt, type VoiceCaptureStatus } from '@/lib/voice-prompt-recorder';
import {
  effectiveCalibration,
  saveCalibration,
  computePinchThresholds,
  type CalibrationData,
} from '@/lib/calibration';
import { PINCH_ON, PINCH_OFF, PINCH_RELEASE_GRACE_FRAMES } from '@/lib/constants';
import { applyPenDeadzone } from '@/lib/geometry';
import { commandFingerCount, GestureHoldDetector } from '@/lib/gestures';
import CalibrationOverlay, { type CalibrationPhase } from './CalibrationOverlay';
import GestureGuide from './GestureGuide';
import { shouldProcessVideoFrame } from '@/lib/frame-loop';
import { shouldActivateControl, updateDwell, initialDwell, type DwellState } from '@/lib/control-selection';
import {
  isAllowedGeneratedImageUrl,
  scaleStrokeInPlace,
  shouldSplitReacquiredStroke,
} from '@/lib/stage-reliability';

type LatencyStats = {
  avgDetectMs: number;
  maxDetectMs: number;
  avgLoopMs: number;
  maxLoopMs: number;
  avgFrameIntervalMs: number;
  maxFrameIntervalMs: number;
};

const emptyLatencyStats: LatencyStats = {
  avgDetectMs: 0,
  maxDetectMs: 0,
  avgLoopMs: 0,
  maxLoopMs: 0,
  avgFrameIntervalMs: 0,
  maxFrameIntervalMs: 0,
};

function abortableDelay(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = window.setTimeout(resolve, ms);
    signal.addEventListener('abort', () => {
      window.clearTimeout(timer);
      reject(new DOMException('Aborted', 'AbortError'));
    }, { once: true });
  });
}

function preloadImage(src: string, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    const cleanup = () => {
      image.onload = null;
      image.onerror = null;
      signal.removeEventListener('abort', onAbort);
    };
    const onAbort = () => {
      cleanup();
      image.src = '';
      reject(new DOMException('Aborted', 'AbortError'));
    };
    image.onload = () => { cleanup(); resolve(); };
    image.onerror = () => { cleanup(); reject(new Error('Generated image failed to load')); };
    signal.addEventListener('abort', onAbort, { once: true });
    image.src = src;
  });
}

export default function AirCanvas() {
  const [appState, setAppState] = useState<AppState>('INITIALIZING');
  const [banner, setBanner] = useState<string | null>(null);
  const [debugOn, setDebugOn] = useState(false);
  // Presenter camera is visible by default; toggle with C when measuring the
  // raw CV path without the extra composited video layer.
  const [cameraPreviewOn, setCameraPreviewOn] = useState(true);
  const [bootstrapAttempt, setBootstrapAttempt] = useState(0);
  const [cameraStream, setCameraStream] = useState<MediaStream | null>(null);
  const [hoveredButton, setHoveredButton] = useState<ButtonId | null>(null);
  const [clearConfirming, setClearConfirming] = useState(false);
  const clearConfirmingRef = useRef(false);
  const [undoConfirming, setUndoConfirming] = useState(false);
  const undoConfirmingRef = useRef(false);
  const [strokeCount, setStrokeCount] = useState(0);
  const [fps, setFps] = useState(0);
  const [latencyStats, setLatencyStats] = useState<LatencyStats>(emptyLatencyStats);
  const [resultUrl, setResultUrl] = useState<string | null>(null);
  const [resultEngine, setResultEngine] = useState<string | null>(null);
  const [sketchUrl, setSketchUrl] = useState<string | null>(null);
  // Calibration
  const [calMode, setCalMode] = useState<CalibrationPhase | null>(null);
  const [calProgress, setCalProgress] = useState(0);
  const calModeRef = useRef<CalibrationPhase | null>(null);
  const calRef = useRef<CalibrationData>(effectiveCalibration());
  const calSamplesRef = useRef({
    minX: 1, maxX: 0, minY: 1, maxY: 0,
    startedAt: 0,
    rangeXs: [] as number[],
    rangeYs: [] as number[],
    pinchDists: [] as number[],
  });

  const [selectedStyle, setSelectedStyle] = useState<StyleKey | null>(null);
  const selectedStyleRef = useRef<StyleKey | null>(null);
  const [hoveredStyle, setHoveredStyle] = useState<StyleKey | null>(null);
  const [voicePrompt, setVoicePrompt] = useState('');
  const voicePromptRef = useRef('');
  const [voiceTranscript, setVoiceTranscript] = useState('');
  const [voiceStatus, setVoiceStatus] = useState<VoiceCaptureStatus | 'idle' | 'ready' | 'error'>('idle');
  const voiceCaptureAbortRef = useRef<AbortController | null>(null);
  // Ink color — selected via the right-side palette; tints cursor dot + strokes
  const [inkColor, setInkColor] = useState<string>(INK);
  const inkColorRef = useRef<string>(INK);
  const [brushSize, setBrushSize] = useState(STROKE_WIDTH);
  const brushSizeRef = useRef(STROKE_WIDTH);
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
  const isPinchingRef = useRef(false);
  const [debugFrame, setDebugFrame] = useState<HandFrame | null>(null);
  const hoveredButtonRef = useRef<ButtonId | null>(null);
  const hoveredStyleRef = useRef<StyleKey | null>(null);
  const hoveredColorRef = useRef<string | null>(null);
  const hoveredShapeRef = useRef<ShapeId | null>(null);
  const dwellProgressRef = useRef(0);

  const videoRef = useRef<HTMLVideoElement>(null);
  const drawingRef = useRef<DrawingCanvasHandle>(null);
  const landmarkerRef = useRef<Awaited<ReturnType<typeof createHandLandmarker>> | null>(null);
  const rafRef = useRef(0);
  const lastVideoTimeRef = useRef(-1);
  const latencyRef = useRef({
    count: 0,
    detectTotal: 0,
    detectMax: 0,
    loopTotal: 0,
    loopMax: 0,
    frameIntervalTotal: 0,
    frameIntervalMax: 0,
    lastFrameAt: 0,
  });
  const prevFrameRef = useRef<HandFrame | null>(null);
  const stateRef = useRef<AppState>('INITIALIZING');
  const strokesRef = useRef<Stroke[]>([]);
  const currentStrokeRef = useRef<Stroke | null>(null);
  const buttonRectsRef = useRef<Record<ButtonId, DOMRect | null>>({
    UNDO: null,
    CLEAR: null,
    GENERATE: null,
    CLOSE: null,
  });
  const lastClickRef = useRef<Record<ButtonId, number>>({ UNDO: 0, CLEAR: 0, GENERATE: 0, CLOSE: 0 });
  // Frames of lost hand tracking tolerated before committing the open stroke
  const handLostFramesRef = useRef(0);
  // Click anchor: cursor position while the pinch is comfortably open. The
  // index tip travels 100px+ toward the thumb as a pinch closes, so clicking
  // the live position misses the control the user was actually aiming at.
  const clickAnchorRef = useRef({ x: 0, y: 0 });
  // Dwell-to-select state — aiming at a control and holding activates it.
  const dwellRef = useRef<DwellState>(initialDwell);
  // 0..1 progress of the current dwell, for the radial progress ring.
  const [dwellProgress, setDwellProgress] = useState(0);
  // Frames the pinch has stayed released while a stroke is open
  const pinchReleasedFramesRef = useRef(0);
  const clearTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const undoTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const styleRectsRef = useRef<Partial<Record<StyleKey, DOMRect | null>>>({});
  const lastStyleClickRef = useRef(0);
  const brushSliderRectRef = useRef<DOMRect | null>(null);
  const colorRectsRef = useRef<Record<string, DOMRect | null>>({});
  const lastColorClickRef = useRef(0);
  // Two-finger gesture toggles the color palette
  const paletteOpenRef = useRef(false);
  // Multi-finger gestures (3 = shape picker, 4 = eraser, 5 = undo)
  const gestureHoldRef = useRef(new GestureHoldDetector());
  const shapeRectsRef = useRef<Partial<Record<ShapeId, DOMRect | null>>>({});
  const lastShapeClickRef = useRef(0);
  const eraserWidthRef = useRef(STROKE_WIDTH * 6);
  const generationAbortRef = useRef<AbortController | null>(null);
  const generationIdRef = useRef(0);
  const cameraPreviewRectRef = useRef<DOMRect | null>(null);
  const registerCameraPreviewRect = useCallback((rect: DOMRect | null) => {
    cameraPreviewRectRef.current = rect;
  }, []);

  // MotionValues — cursor position updates without React re-render
  const cursorX = useMotionValue(0);
  const cursorY = useMotionValue(0);

  const setState = useCallback((s: AppState) => {
    stateRef.current = s;
    setAppState(s);
  }, []);

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

  // ─── Actions ────────────────────────────────────────────────────────────────

  const commitCurrentStroke = useCallback(() => {
    const stroke = currentStrokeRef.current;
    if (!stroke) return false;
    currentStrokeRef.current = null;
    pinchReleasedFramesRef.current = 0;

    // A single point has no visible output and must not enable generation.
    if (stroke.points.length < 2) {
      drawingRef.current?.redraw(strokesRef.current);
      return false;
    }

    strokesRef.current.push(stroke);
    drawingRef.current?.redraw(strokesRef.current);
    setStrokeCount(strokesRef.current.length);
    if (stroke.shape) setShapeState(null); // shape selection is one-shot
    return true;
  }, [setShapeState]);

  const handleCanvasResize = useCallback((scaleX: number, scaleY: number) => {
    strokesRef.current.forEach((stroke) => scaleStrokeInPlace(stroke, scaleX, scaleY));
    if (currentStrokeRef.current) scaleStrokeInPlace(currentStrokeRef.current, scaleX, scaleY);
  }, []);

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

  const triggerGenerate = useCallback(async (promptOverride?: string) => {
    if (stateRef.current === 'GENERATING' || stateRef.current === 'CAPTURE') return;
    const spokenPrompt = promptOverride?.trim() || voicePromptRef.current.trim();
    if (!spokenPrompt) {
      setBanner('PRESS M AND SPEAK YOUR IMAGE PROMPT FIRST');
      setTimeout(() => setBanner(null), 3000);
      return;
    }
    commitCurrentStroke();
    if (strokesRef.current.length === 0) return;
    generationAbortRef.current?.abort();
    const controller = new AbortController();
    const generationId = ++generationIdRef.current;
    generationAbortRef.current = controller;
    setState('CAPTURE');
    setBanner('SKETCH CAPTURED ✓');
    sound.captured();
    try {
      const blob = await drawingRef.current!.exportPng();
      if (controller.signal.aborted || generationId !== generationIdRef.current) return;
      const nextSketchUrl = URL.createObjectURL(blob);
      setSketchUrl((previous) => {
        if (previous) URL.revokeObjectURL(previous);
        return nextSketchUrl;
      });
      setState('GENERATING');
      sound.generateStart();
      const form = new FormData();
      form.append('image', blob, 'sketch.png');
      if (selectedStyleRef.current) form.append('style', selectedStyleRef.current);
      form.append('prompt', spokenPrompt);
      const res = await fetch('/api/generate', { method: 'POST', body: form, signal: controller.signal });
      if (!res.ok) throw new Error('API error');
      const data = await res.json();
      if (!isAllowedGeneratedImageUrl(data.imageUrl)) {
        throw new Error('Invalid generated image response');
      }
      await preloadImage(data.imageUrl, controller.signal);
      if (generationId !== generationIdRef.current) return;
      setResultUrl(data.imageUrl);
      setResultEngine(typeof data.engine === 'string' ? data.engine : 'unknown');
      // Hold on the reveal ~1.4s after the asset arrives (PRD §26)
      await abortableDelay(1400, controller.signal);
      if (generationId !== generationIdRef.current) return;
      sound.reveal();
      setState('RESULT');
      setBanner(null);
    } catch (error) {
      if (controller.signal.aborted || generationId !== generationIdRef.current) return;
      // Sketch preserved on failure
      setState('DRAWING');
      setBanner(error instanceof Error && error.name === 'AbortError'
        ? null
        : 'GENERATION FAILED — CHECK AI STATUS; SKETCH PRESERVED');
      setTimeout(() => setBanner(null), 3000);
    } finally {
      if (generationAbortRef.current === controller) generationAbortRef.current = null;
    }
  }, [commitCurrentStroke, setState]);

  const triggerReset = useCallback(() => {
    generationIdRef.current++;
    generationAbortRef.current?.abort();
    generationAbortRef.current = null;
    voiceCaptureAbortRef.current?.abort();
    voiceCaptureAbortRef.current = null;
    strokesRef.current = [];
    currentStrokeRef.current = null;
    drawingRef.current?.clear();
    setStrokeCount(0);
    setResultUrl(null);
    setResultEngine(null);
    if (sketchUrl) URL.revokeObjectURL(sketchUrl);
    setSketchUrl(null);
    setSelectedStyle(null);
    selectedStyleRef.current = null;
    setVoicePrompt('');
    voicePromptRef.current = '';
    setVoiceTranscript('');
    setVoiceStatus('idle');
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
      rangeXs: [],
      rangeYs: [],
      pinchDists: [],
    };
    calModeRef.current = 'RANGE';
    setCalMode('RANGE');
    setCalProgress(0);
  }, []);

  const finishCalibration = useCallback(() => {
    const s = calSamplesRef.current;
    const percentile = (values: number[], fraction: number) => {
      const sorted = [...values].sort((a, b) => a - b);
      return sorted[Math.floor((sorted.length - 1) * fraction)];
    };
    const minX = percentile(s.rangeXs, 0.05) ?? s.minX;
    const maxX = percentile(s.rangeXs, 0.95) ?? s.maxX;
    const minY = percentile(s.rangeYs, 0.05) ?? s.minY;
    const maxY = percentile(s.rangeYs, 0.95) ?? s.maxY;
    if (maxX - minX >= 0.1 && maxY - minY >= 0.1) {
      const pinch = s.pinchDists.length >= 4
        ? computePinchThresholds(s.pinchDists)
        : { on: PINCH_ON, off: PINCH_OFF };
      const data: CalibrationData = {
        minX, maxX, minY, maxY,
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

  const isOverBrushSlider = useCallback((x: number, y: number): boolean => {
    const rect = brushSliderRectRef.current;
    return Boolean(
      rect && x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom
    );
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
      if (isOverBrushSlider(x, y)) return;
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
    [hitTest, hitTestStyle, isOverBrushSlider, hitTestColor, hitTestShape, triggerUndo, triggerClear, triggerGenerate, toggleMenu, setPaletteState, setShapeState, setShapePickerState, setToolState]
  );

  // ─── Voice prompt: local capture → Qwen Audio → Qwen prompt guard ──────────

  const captureSpokenPrompt = useCallback(async () => {
    if (voiceCaptureAbortRef.current) {
      voiceCaptureAbortRef.current.abort();
      voiceCaptureAbortRef.current = null;
      setVoiceStatus(voicePromptRef.current ? 'ready' : 'idle');
      setBanner(null);
      return;
    }
    const controller = new AbortController();
    voiceCaptureAbortRef.current = controller;
    voicePromptRef.current = '';
    setVoicePrompt('');
    setVoiceTranscript('');
    setVoiceStatus('listening');
    setBanner('SPEAK YOUR IMAGE PROMPT…');
    try {
      const audio = await captureVoicePrompt({
        signal: controller.signal,
        onStatus: setVoiceStatus,
      });
      const form = new FormData();
      form.append('audio', audio, 'voice-prompt.wav');
      if (strokesRef.current.length > 0 && drawingRef.current) {
        const sketch = await drawingRef.current.exportPng();
        form.append('sketch', sketch, 'sketch-context.png');
      }
      const response = await fetch('/api/transcribe', {
        method: 'POST',
        body: form,
        signal: controller.signal,
      });
      if (!response.ok) throw new Error('Voice prompt API error');
      const data = await response.json() as { prompt?: unknown; transcript?: unknown };
      if (typeof data.prompt !== 'string' || data.prompt.trim().length < 3) {
        throw new Error('Voice prompt was empty');
      }
      const prompt = data.prompt.trim();
      const transcript = typeof data.transcript === 'string' ? data.transcript.trim() : '';
      voicePromptRef.current = prompt;
      setVoicePrompt(prompt);
      setVoiceTranscript(transcript);
      setVoiceStatus('ready');
      setBanner(`PROMPT READY: ${prompt.toUpperCase()}`);
      setTimeout(() => setBanner(null), 4000);
      sound.click();
    } catch {
      if (controller.signal.aborted) return;
      setVoiceStatus('error');
      setBanner('VOICE PROMPT FAILED — PRESS M TO TRY AGAIN');
      setTimeout(() => setBanner(null), 3500);
    } finally {
      if (voiceCaptureAbortRef.current === controller) voiceCaptureAbortRef.current = null;
    }
  }, []);

  useEffect(() => () => {
    generationIdRef.current++;
    generationAbortRef.current?.abort();
  }, []);

  // ─── Keyboard failsafes ─────────────────────────────────────────────────────

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      switch (e.key.toLowerCase()) {
        case 'g': triggerGenerate(); break;
        case 'z': triggerUndo(true); break;
        case 'x': triggerClear(true); break;
        case 'r':
          if (stateRef.current === 'INITIALIZING' || stateRef.current === 'CAMERA_PERMISSION') {
            setBootstrapAttempt((value) => value + 1);
          } else {
            triggerReset();
          }
          break;
        case 'c': setCameraPreviewOn(v => !v); break;
        case 'd': setDebugOn(v => !v); break;
        case 'f': toggleFullscreen(); break;
        case 's': sound.toggle(); break;
        case 'v': togglePalette(); break;
        case 'm': void captureSpokenPrompt(); break;
        case 'b':
          if (calModeRef.current) cancelCalibration();
          else if (stateRef.current === 'READY' || stateRef.current === 'DRAWING') startCalibration();
          break;
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [triggerGenerate, triggerUndo, triggerClear, triggerReset, toggleFullscreen, startCalibration, cancelCalibration, togglePalette, captureSpokenPrompt]);

  // ─── Main loop ─────────────────────────────────────────────────────────────

  useEffect(() => {
    let cancelled = false;
    let fpsCount = 0;
    let lastFpsTime = performance.now();

    async function init() {
      setState('INITIALIZING');
      setBanner(null);
      setCameraStream(null);
      prevFrameRef.current = null;
      lastVideoTimeRef.current = -1;
      handLostFramesRef.current = 0;
      let landmarker: Awaited<ReturnType<typeof createHandLandmarker>>;
      try {
        landmarker = await createHandLandmarker();
      } catch (error) {
        if (!cancelled) {
          console.error('Hand tracking initialization failed:', error);
          setBanner('HAND TRACKING FAILED — CHECK NETWORK; PRESS R TO RETRY');
        }
        return;
      }
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
        if (!cancelled) setBanner('CAMERA UNAVAILABLE — CHECK PERMISSION; PRESS R TO RETRY');
        return;
      }

      setState('READY');
      setBanner(null);
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

      // rAF commonly runs at 60Hz while webcams deliver 30 FPS. Never run the
      // expensive MediaPipe graph twice for the same decoded video frame.
      if (!shouldProcessVideoFrame(lastVideoTimeRef.current, video.currentTime)) {
        rafRef.current = requestAnimationFrame(loop);
        return;
      }
      lastVideoTimeRef.current = video.currentTime;

      const frameStartedAt = performance.now();
      const latency = latencyRef.current;
      if (latency.lastFrameAt > 0) {
        const frameIntervalMs = frameStartedAt - latency.lastFrameAt;
        latency.frameIntervalTotal += frameIntervalMs;
        latency.frameIntervalMax = Math.max(latency.frameIntervalMax, frameIntervalMs);
      }
      latency.lastFrameAt = frameStartedAt;

      const [cw, ch] = drawing.size();
      const canvasRect = drawing.rect();
      const detectStartedAt = performance.now();
      const result = landmarker.detectForVideo(video, detectStartedAt);
      const detectMs = performance.now() - detectStartedAt;
      latency.count++;
      latency.detectTotal += detectMs;
      latency.detectMax = Math.max(latency.detectMax, detectMs);
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
          s.rangeXs.push(frame.rawIndex.x);
          s.rangeYs.push(frame.rawIndex.y);
          const elapsed = Date.now() - s.startedAt;
          setCalProgress(Math.min(elapsed / 8000, 1));
          if (elapsed >= 8000) {
            calModeRef.current = 'PINCH';
            s.startedAt = Date.now();
            setCalMode('PINCH');
            setCalProgress(0);
          }
        } else {
          s.pinchDists.push(frame.pinchDist);
          const elapsed = Date.now() - s.startedAt;
          setCalProgress(Math.min(elapsed / 6000, 1));
          if (elapsed >= 6000) finishCalibration();
        }
      }

      cursorX.set(vx);
      cursorY.set(vy);

      // Tool gestures ignore the thumb because it is also the pinch finger,
      // while a true 5-finger open palm is reserved for the command wheel:
      //   2 (index+middle) = color palette, 3 = shape picker, 4 = eraser
      //   toggle, 5 (open palm) = main menu popup.
      // A short time-based hold avoids false triggers without becoming slower
      // when CV FPS drops. The detector fires once until the pose changes.
      if (
        frame.detected &&
        stateRef.current === 'DRAWING' &&
        !calModeRef.current &&
        !menuOpenRef.current
      ) {
        const count = commandFingerCount(frame);
        const triggeredCount = gestureHoldRef.current.update(count, performance.now());
        if (triggeredCount) {
          sound.click();
          if (triggeredCount === 2) {
            togglePalette();
          } else if (triggeredCount === 3) {
            setShapePickerState(!shapePickerOpenRef.current);
          } else if (triggeredCount === 4) {
            const next: ToolId = toolRef.current === 'eraser' ? 'pen' : 'eraser';
            setToolState(next);
            setShapeState(null);
            setBanner(next === 'eraser' ? 'ERASER ON' : 'PEN ON');
          } else if (triggeredCount === 5) {
            toggleMenu();
          }
        }
      } else {
        gestureHoldRef.current.reset();
      }

      // Count processed camera frames; stats are published at the end of the
      // frame after all loop work has been measured.
      fpsCount++;
      if (isPinchingRef.current !== frame.pinching) {
        isPinchingRef.current = frame.pinching;
        setIsPinching(frame.pinching);
      }

      // State transition: hand appears
      if (stateRef.current === 'READY' && frame.detected) {
        setState('DRAWING');
        setBanner(null);
        sound.trackingOn();
      }
      // Grace period: tolerate brief detection dropouts so the stroke (and
      // paint mode) doesn't flicker off for a lost frame or two.
      const lostFramesBefore = handLostFramesRef.current;
      const reacquired = frame.detected && lostFramesBefore > 0;
      handLostFramesRef.current = frame.detected ? 0 : lostFramesBefore + 1;
      const handLost = handLostFramesRef.current > HAND_LOST_GRACE_FRAMES;
      if (reacquired && currentStrokeRef.current) {
        const points = currentStrokeRef.current.points;
        const lastPoint = points[points.length - 1];
        if (shouldSplitReacquiredStroke(lostFramesBefore, lastPoint, frame.cursor, MAX_REACQUIRE_JUMP_PX)) {
          commitCurrentStroke();
        }
      }
      if (handLostFramesRef.current === HAND_LOST_GRACE_FRAMES + 1) {
        resetHandSmoothing();
      }
      if (stateRef.current === 'DRAWING' && handLost && currentStrokeRef.current) {
        // Hand truly lost mid-drawing — finish current stroke, stay in DRAWING
        commitCurrentStroke();
      }

      // Suppress drawing during calibration
      if (calModeRef.current) {
        rafRef.current = requestAnimationFrame(loop);
        return;
      }

      // Suppress drawing while the cursor is over a virtual control
      const buttonHit = hitTest(vx, vy);
      const styleHit = hitTestStyle(vx, vy);
      const colorHit = hitTestColor(vx, vy);
      const shapeHit = hitTestShape(vx, vy);
      const cameraPreviewHit = Boolean(cameraPreviewRectRef.current &&
        vx >= cameraPreviewRectRef.current.left &&
        vx <= cameraPreviewRectRef.current.right &&
        vy >= cameraPreviewRectRef.current.top &&
        vy <= cameraPreviewRectRef.current.bottom);
      const overControl = buttonHit !== null || styleHit !== null || colorHit !== null || shapeHit !== null || cameraPreviewHit;

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
        if (frame.pinching) {
          pinchReleasedFramesRef.current = 0;
          if (!currentStrokeRef.current) {
            currentStrokeRef.current = {
              points: [frame.cursor],
              width: toolRef.current === 'eraser' ? eraserWidthRef.current : brushSizeRef.current,
              // Eraser paints white — canvas background is white
              color: toolRef.current === 'eraser' ? '#ffffff' : inkColorRef.current,
              shape: toolRef.current === 'eraser' ? undefined : (activeShapeRef.current ?? undefined),
              tool: toolRef.current,
            };
          } else {
            const stroke = currentStrokeRef.current;
            // Deadzone: jitter below PEN_DEADZONE_PX never joins the stroke —
            // the pen tip holds still when the hand does.
            const committed = applyPenDeadzone(frame.cursor, stroke.points[stroke.points.length - 1]);
            if (committed) {
              stroke.points.push(committed);
              drawing.renderLive(stroke);
            }
          }
        } else if (currentStrokeRef.current) {
          // Grace period: brief pinch wobbles during fast drawing must not
          // split one line into multiple strokes — only commit after the
          // pinch stays released for PINCH_RELEASE_GRACE_FRAMES frames.
          pinchReleasedFramesRef.current++;
          if (pinchReleasedFramesRef.current > PINCH_RELEASE_GRACE_FRAMES) {
            commitCurrentStroke();
          }
        }
      } else if (frame.detected && !handLost && currentStrokeRef.current) {
        // Hand present but cursor moved over a control — commit the stroke.
        // (Hand-lost case is handled above after the grace period expires.)
        commitCurrentStroke();
      }
      // While hand is briefly lost (within the grace window), the open stroke
      // is NOT committed — drawing resumes the same stroke when the hand
      // returns, instead of starting a new one mid-line.

      // Button hover + click (viewport coords vs DOM rects)
      if (frame.detected) {
        const brushSliderActive = paletteOpenRef.current && isOverBrushSlider(vx, vy);
        if (brushSliderActive && frame.pinching) {
          const rect = brushSliderRectRef.current!;
          const progress = Math.min(1, Math.max(0, (vx - rect.left) / rect.width));
          const nextSize = Math.round(
            MIN_BRUSH_SIZE + progress * (MAX_BRUSH_SIZE - MIN_BRUSH_SIZE)
          );
          if (nextSize !== brushSizeRef.current) {
            brushSizeRef.current = nextSize;
            setBrushSize(nextSize);
          }
        }

        if (hoveredButtonRef.current !== buttonHit) {
          hoveredButtonRef.current = buttonHit;
          setHoveredButton(buttonHit);
        }
        if (hoveredStyleRef.current !== styleHit) {
          hoveredStyleRef.current = styleHit;
          setHoveredStyle(styleHit);
        }
        if (hoveredColorRef.current !== colorHit) {
          hoveredColorRef.current = colorHit;
          setHoveredColor(colorHit);
        }
        if (hoveredShapeRef.current !== shapeHit) {
          hoveredShapeRef.current = shapeHit;
          setHoveredShape(shapeHit);
        }

        // While a control is hovered, freeze the click anchor: closing a
        // pinch folds the index tip toward the thumb, dragging the cursor off
        // the target right before the click registers.
        const hoveredNow = buttonHit ?? shapeHit ?? colorHit ?? styleHit ?? (isOverBrushSlider(vx, vy) ? 'BRUSH_SIZE_SLIDER' : null);
        if (hoveredNow) clickAnchorRef.current = { x: vx, y: vy };
        if (shouldActivateControl(frame.pinching, prev?.pinching ?? false)) {
          handlePinchClick(clickAnchorRef.current.x, clickAnchorRef.current.y);
        }

        // Dwell-to-select: hold the cursor on a control to activate it —
        // no pinch needed. Leaving the control resets the timer.
        const dwell = updateDwell(
          dwellRef.current,
          brushSliderActive ? null : hoveredNow,
          performance.now(),
          DWELL_SELECT_MS
        );
        dwellRef.current = dwell.state;
        const nextDwellProgress = dwell.state.key ? Math.min((performance.now() - dwell.state.since) / DWELL_SELECT_MS, 1) : 0;
        const roundedDwellProgress = Math.round(nextDwellProgress * 20) / 20;
        if (dwellProgressRef.current !== roundedDwellProgress) {
          dwellProgressRef.current = roundedDwellProgress;
          setDwellProgress(roundedDwellProgress);
        }
        if (dwell.activated) {
          sound.click();
          handlePinchClick(clickAnchorRef.current.x, clickAnchorRef.current.y);
        }
      }

      const loopMs = performance.now() - frameStartedAt;
      latency.loopTotal += loopMs;
      latency.loopMax = Math.max(latency.loopMax, loopMs);

      const now = performance.now();
      if (now - lastFpsTime >= 1000) {
        setFps(fpsCount * (1000 / (now - lastFpsTime)));
        setDebugFrame(frame);
        const samples = Math.max(1, latency.count);
        const intervalSamples = Math.max(1, latency.count - 1);
        setLatencyStats({
          avgDetectMs: latency.detectTotal / samples,
          maxDetectMs: latency.detectMax,
          avgLoopMs: latency.loopTotal / samples,
          maxLoopMs: latency.loopMax,
          avgFrameIntervalMs: latency.frameIntervalTotal / intervalSamples,
          maxFrameIntervalMs: latency.frameIntervalMax,
        });
        latency.count = 0;
        latency.detectTotal = 0;
        latency.detectMax = 0;
        latency.loopTotal = 0;
        latency.loopMax = 0;
        latency.frameIntervalTotal = 0;
        latency.frameIntervalMax = 0;
        fpsCount = 0;
        lastFpsTime = now;
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
      landmarkerRef.current = null;
      resetHandSmoothing();
    };
  }, [bootstrapAttempt, commitCurrentStroke, setState, cursorX, cursorY, hitTest, hitTestStyle, isOverBrushSlider, hitTestColor, hitTestShape, handlePinchClick, togglePalette, setShapePickerState, setToolState, setShapeState, toggleMenu, finishCalibration]);

  // ─── Cursor visual state ────────────────────────────────────────────────────

  const cursorState: CursorState =
    hoveredButton || hoveredStyle || hoveredColor || hoveredShape
      ? 'hover'
      : isPinching
        ? 'pinch'
        : 'normal';

  // ─── Render ─────────────────────────────────────────────────────────────────

  return (
    <div className="relative flex h-screen w-screen overflow-hidden bg-[#050510]">
      {/* Hidden video element for MediaPipe */}
      <video ref={videoRef} autoPlay playsInline muted className="hidden" />

      {/* Left rail: gesture guide — canvas gets its own column, never overlapped */}
      {(appState === 'READY' || appState === 'DRAWING') && (
        <GestureGuide
          pinching={isPinching}
          tool={tool}
          activeShape={activeShape}
          inkColor={inkColor}
        />
      )}

      {/* Drawing canvas — center column, flexes to fill */}
      <DrawingCanvas ref={drawingRef} onResize={handleCanvasResize} />

      {/* Controls — everything hidden except the tool badge; menu is a
          5-finger popup so the canvas stays free of buttons while drawing */}
      {appState === 'DRAWING' && (
        <>
          {paletteOpen && (
            <ColorPicker
              selected={inkColor}
              hovered={hoveredColor}
              brushSize={brushSize}
              registerRect={(color, rect) => { colorRectsRef.current[color] = rect; }}
              registerBrushSliderRect={(rect) => { brushSliderRectRef.current = rect; }}
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
              generateDisabled={strokeCount === 0 || !voicePrompt}
              onUndo={() => triggerUndo()}
              onClear={() => triggerClear()}
              onGenerate={() => {
                setMenuState(false);
                triggerGenerate();
              }}
              onSelectStyle={(style) => {
                setSelectedStyle(style);
                selectedStyleRef.current = style;
                sound.click();
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
              <p className="mb-3 text-sm tracking-[0.3em] text-cyan-300">
                {resultEngine === 'qwen' ? 'QWEN AI CREATION' : 'AI STATUS UNKNOWN'}
              </p>
              {resultUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={resultUrl} alt="AI generated" className="h-[270px] w-[360px] rounded-xl object-cover" />
              ) : (
                <div className="h-[270px] w-[360px] rounded-xl bg-white/5" />
              )}
            </div>
          </div>
          {voicePrompt && (
            <p className="max-w-4xl text-center text-sm tracking-[0.16em] text-slate-300">
              SPOKEN PROMPT: {voicePrompt}
              {selectedStyle && <span className="ml-6 text-cyan-300">STYLE: {selectedStyle}</span>}
            </p>
          )}
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
      <HandCursor x={cursorX} y={cursorY} state={cursorState} color={inkColor} dwellProgress={dwellProgress} />

      {/* Status */}
      <StatusBanner state={appState} custom={banner} />

      {/* Debug */}
      {debugOn && (
        <DebugPanel
          fps={fps}
          frame={debugFrame}
          state={appState}
          strokeCount={strokeCount}
          latency={latencyStats}
        />
      )}

      {/* Right rail: voice monitor + camera pip — its own column, never covers canvas */}
      {cameraPreviewOn && appState !== 'RESULT' && (
        <CameraPreview
          stream={cameraStream}
          onRect={registerCameraPreviewRect}
          voiceStatus={voiceStatus}
          voiceTranscript={voiceTranscript}
          voicePrompt={voicePrompt}
        />
      )}
    </div>
  );
}
