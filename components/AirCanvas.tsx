"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { motion, useMotionValue } from "framer-motion";
import {
  createHandLandmarker,
  extractHandFrame,
  getExtrapolatedCursor,
} from "@/lib/hand-tracking";
import { drawStrokeSegment, redrawAll } from "@/lib/strokes";
import { recognizeShape } from "@/lib/shape-recognizer";
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
  PINCH_ON,
  PINCH_OFF,
  PINCH_RELEASE_GRACE_FRAMES,
} from "@/lib/constants";
import type {
  AppState,
  ButtonId,
  HandFrame,
  Stroke,
  ShapeId,
  ToolId,
  DrawMode,
  GestureType,
  LandmarkPoint,
} from "@/lib/types";
import DrawingCanvas, { type DrawingCanvasHandle } from "./DrawingCanvas";
import HandCursor, { type CursorState } from "./HandCursor";
import GestureHUD from "./GestureHUD";
import MainMenu from "./MainMenu";
import StatusBanner from "./StatusBanner";
import DebugPanel from "./DebugPanel";
import CameraPreview from "./CameraPreview";
import LoadingExperience from "./LoadingExperience";
import ColorPicker from "./ColorPicker";
import ShapePicker, { SHAPES } from "./ShapePicker";
import { STYLES, type StyleKey } from "@/lib/prompt";
import { sound } from "@/lib/sound";
import {
  VoiceController,
  voiceSupported,
  type VoiceCommand,
} from "@/lib/voice";
import {
  effectiveCalibration,
  saveCalibration,
  computePinchThresholds,
  type CalibrationData,
} from "@/lib/calibration";
import { applyPenDeadzone } from "@/lib/geometry";
import CalibrationOverlay, {
  type CalibrationPhase,
} from "./CalibrationOverlay";

export default function AirCanvas() {
  const [appState, setAppState] = useState<AppState>("INITIALIZING");
  const [banner, setBanner] = useState<string | null>(null);
  const [debugOn, setDebugOn] = useState(false);
  const [cameraPreviewOn, setCameraPreviewOn] = useState(true);
  const [cameraStream, setCameraStream] = useState<MediaStream | null>(null);

  // 60 FPS Landmark Pipeline (Ref-backed to prevent parent React re-renders)
  const landmarksRef = useRef<LandmarkPoint[] | undefined>(undefined);

  // Drawing Mode & Smart Shape Recognition
  const [drawMode, setDrawMode] = useState<DrawMode>("smart");
  const drawModeRef = useRef<DrawMode>("smart");
  const [autoShape, setAutoShape] = useState<boolean>(true);
  const autoShapeRef = useRef<boolean>(true);
  const [detectedShapeToast, setDetectedShapeToast] = useState<string | null>(null);
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Brush Size & Neon Mode
  const [brushSize, setBrushSize] = useState<number>(STROKE_WIDTH);
  const brushSizeRef = useRef<number>(STROKE_WIDTH);
  const [glowMode, setGlowMode] = useState<boolean>(false);
  const glowModeRef = useRef<boolean>(false);

  // Gesture HUD State (Diffed to avoid per-frame re-renders)
  const [activeGesture, setActiveGesture] = useState<GestureType>("hover");
  const activeGestureRef = useRef<GestureType>("hover");
  const [isPointing, setIsPointing] = useState(false);
  const isPointingRef = useRef(false);

  // Hover & Action States
  const [hoveredButton, setHoveredButton] = useState<ButtonId | null>(null);
  const hoveredButtonRef = useRef<ButtonId | null>(null);

  const [clearConfirming, setClearConfirming] = useState(false);
  const clearConfirmingRef = useRef(false);
  const [undoConfirming, setUndoConfirming] = useState(false);
  const undoConfirmingRef = useRef(false);

  const [strokeCount, setStrokeCount] = useState(0);
  const [redoCount, setRedoCount] = useState(0);
  const [fps, setFps] = useState(0);
  const [resultUrl, setResultUrl] = useState<string | null>(null);
  const [sketchUrl, setSketchUrl] = useState<string | null>(null);

  // Calibration
  const [calMode, setCalMode] = useState<CalibrationPhase | null>(null);
  const [calProgress, setCalProgress] = useState(0);
  const calModeRef = useRef<CalibrationPhase | null>(null);
  const calRef = useRef<CalibrationData>(effectiveCalibration());
  const calSamplesRef = useRef({
    minX: 1,
    maxX: 0,
    minY: 1,
    maxY: 0,
    startedAt: 0,
    pinchDists: [] as number[],
    pinchCycles: 0,
    wasPinching: false,
  });

  const [selectedStyle, setSelectedStyle] = useState<StyleKey | null>(null);
  const selectedStyleRef = useRef<StyleKey | null>(null);
  const [hoveredStyle, setHoveredStyle] = useState<StyleKey | null>(null);
  const hoveredStyleRef = useRef<StyleKey | null>(null);

  // Ink Color & Overlays
  const [inkColor, setInkColor] = useState<string>(INK);
  const inkColorRef = useRef<string>(INK);
  const [hoveredColor, setHoveredColor] = useState<string | null>(null);
  const hoveredColorRef = useRef<string | null>(null);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const paletteOpenRef = useRef(false);

  // Tools & Shapes
  const [shapePickerOpen, setShapePickerOpen] = useState(false);
  const shapePickerOpenRef = useRef(false);
  const [activeShape, setActiveShape] = useState<ShapeId | null>(null);
  const activeShapeRef = useRef<ShapeId | null>(null);
  const [hoveredShape, setHoveredShape] = useState<ShapeId | null>(null);
  const hoveredShapeRef = useRef<ShapeId | null>(null);

  const [tool, setTool] = useState<ToolId>("pen");
  const toolRef = useRef<ToolId>("pen");

  const [menuOpen, setMenuOpen] = useState(false);
  const menuOpenRef = useRef(false);

  const [isPinching, setIsPinching] = useState(false);
  const isPinchingRef = useRef(false);
  const [debugFrame, setDebugFrame] = useState<HandFrame | null>(null);
  const [voiceOn, setVoiceOn] = useState(false);
  const [voiceListening, setVoiceListening] = useState(false);
  const [voiceCtrl] = useState(() => new VoiceController());

  // Engine Refs
  const videoRef = useRef<HTMLVideoElement>(null);
  const drawingRef = useRef<DrawingCanvasHandle>(null);
  const landmarkerRef = useRef<Awaited<
    ReturnType<typeof createHandLandmarker>
  > | null>(null);
  const rafRef = useRef(0);
  const prevFrameRef = useRef<HandFrame | null>(null);
  const stateRef = useRef<AppState>("INITIALIZING");
  const strokesRef = useRef<Stroke[]>([]);
  const redoStrokesRef = useRef<Stroke[]>([]);
  const currentStrokeRef = useRef<Stroke | null>(null);
  const generationRequestRef = useRef(0);
  const lastDrawnIndexRef = useRef(0);

  const buttonRectsRef = useRef<Record<ButtonId, DOMRect | null>>({
    UNDO: null,
    CLEAR: null,
    GENERATE: null,
    CLOSE: null,
  });
  const lastClickRef = useRef<Record<ButtonId, number>>({
    UNDO: 0,
    CLEAR: 0,
    GENERATE: 0,
    CLOSE: 0,
  });
  const dwellRef = useRef<{ id: string | null; since: number }>({
    id: null,
    since: 0,
  });

  const handLostFramesRef = useRef(0);
  const pinchReleasedFramesRef = useRef(0);
  const clearTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const undoTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const styleRectsRef = useRef<Partial<Record<StyleKey, DOMRect | null>>>({});
  const lastStyleClickRef = useRef(0);
  const colorRectsRef = useRef<Record<string, DOMRect | null>>({});
  const lastColorClickRef = useRef(0);

  const gestureFramesRef = useRef(0);
  const gestureCooldownRef = useRef(0);
  const lastGestureCountRef = useRef(0);
  const shapeRectsRef = useRef<Partial<Record<ShapeId, DOMRect | null>>>({});
  const lastShapeClickRef = useRef(0);
  const eraserWidthRef = useRef(STROKE_WIDTH * 6);

  // MotionValues for 60fps cursor without React DOM re-renders
  const cursorX = useMotionValue(0);
  const cursorY = useMotionValue(0);

  const setState = useCallback((s: AppState) => {
    stateRef.current = s;
    setAppState(s);
  }, []);

  const setMenuState = useCallback((open: boolean) => {
    menuOpenRef.current = open;
    setMenuOpen(open);
    if (open) {
      clearConfirmingRef.current = false;
      setClearConfirming(false);
      undoConfirmingRef.current = false;
      setUndoConfirming(false);
    }
  }, []);

  const toggleMenu = useCallback(
    () => setMenuState(!menuOpenRef.current),
    [setMenuState],
  );

  const setPaletteState = useCallback((open: boolean) => {
    paletteOpenRef.current = open;
    setPaletteOpen(open);
  }, []);

  const togglePalette = useCallback(
    () => setPaletteState(!paletteOpenRef.current),
    [setPaletteState],
  );

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

  const toggleDrawMode = useCallback(() => {
    const next: DrawMode =
      drawModeRef.current === "smart"
        ? "point"
        : drawModeRef.current === "point"
          ? "pinch"
          : "smart";
    drawModeRef.current = next;
    setDrawMode(next);
    sound.click();
    setBanner(
      next === "smart"
        ? "DRAW MODE: SMART (POINT OR PINCH)"
        : next === "point"
          ? "DRAW MODE: AIR PEN (POINT ONLY)"
          : "DRAW MODE: PINCH ONLY",
    );
    setTimeout(() => setBanner(null), 2000);
  }, []);

  const toggleAutoShape = useCallback(() => {
    const next = !autoShapeRef.current;
    autoShapeRef.current = next;
    setAutoShape(next);
    sound.click();
    setBanner(next ? "MAGIC SHAPE: ON" : "MAGIC SHAPE: OFF");
    setTimeout(() => setBanner(null), 2000);
  }, []);

  const setBrushSizeState = useCallback((size: number) => {
    brushSizeRef.current = size;
    setBrushSize(size);
    sound.click();
    setBanner(`BRUSH SIZE: ${size}PX`);
    setTimeout(() => setBanner(null), 1500);
  }, []);

  const toggleGlowMode = useCallback(() => {
    const next = !glowModeRef.current;
    glowModeRef.current = next;
    setGlowMode(next);
    sound.click();
    setBanner(next ? "NEON GLOW: ON 💡" : "NEON GLOW: OFF");
    setTimeout(() => setBanner(null), 1500);
  }, []);

  const executeUndo = useCallback(() => {
    if (strokesRef.current.length === 0) return;
    const popped = strokesRef.current.pop();
    if (popped) {
      redoStrokesRef.current.push(popped);
      setRedoCount(redoStrokesRef.current.length);
    }
    drawingRef.current?.redraw(strokesRef.current);
    setStrokeCount(strokesRef.current.length);
    undoConfirmingRef.current = false;
    setUndoConfirming(false);
    sound.click();
  }, []);

  const executeRedo = useCallback(() => {
    if (redoStrokesRef.current.length === 0) return;
    const restored = redoStrokesRef.current.pop();
    if (restored) {
      strokesRef.current.push(restored);
      setRedoCount(redoStrokesRef.current.length);
      drawingRef.current?.redraw(strokesRef.current);
      setStrokeCount(strokesRef.current.length);
      sound.click();
    }
  }, []);

  const triggerUndo = useCallback(
    (skipConfirm = false) => {
      if (stateRef.current !== "DRAWING") return;
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
    },
    [executeUndo],
  );

  const triggerRedo = useCallback(() => {
    if (stateRef.current !== "DRAWING") return;
    executeRedo();
  }, [executeRedo]);

  const executeClear = useCallback(() => {
    strokesRef.current = [];
    redoStrokesRef.current = [];
    currentStrokeRef.current = null;
    drawingRef.current?.clear();
    setStrokeCount(0);
    setRedoCount(0);
    setClearConfirming(false);
    clearConfirmingRef.current = false;
    sound.click();
  }, []);

  const triggerClear = useCallback(
    (skipConfirm = false) => {
      if (stateRef.current !== "DRAWING") return;
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
    },
    [executeClear],
  );

  const triggerGenerate = useCallback(
    async (subject?: string) => {
      if (stateRef.current === "GENERATING" || stateRef.current === "CAPTURE")
        return;
      if (strokesRef.current.length === 0) return;
      const requestId = ++generationRequestRef.current;
      setState("CAPTURE");
      setBanner("SKETCH CAPTURED ✓");
      sound.captured();
      try {
        const blob = await drawingRef.current!.exportPng();
        if (requestId !== generationRequestRef.current) return;
        if (sketchUrl) URL.revokeObjectURL(sketchUrl);
        setSketchUrl(URL.createObjectURL(blob));
        setState("GENERATING");
        sound.generateStart();
        const form = new FormData();
        form.append("image", blob, "sketch.png");
        if (selectedStyleRef.current)
          form.append("style", selectedStyleRef.current);
        if (subject) form.append("subject", subject);

        const res = await fetch("/api/generate", {
          method: "POST",
          body: form,
        });
        if (!res.ok) throw new Error("API error");
        const data = await res.json();
        if (requestId !== generationRequestRef.current) return;
        setResultUrl(data.imageUrl);
        await new Promise((r) => setTimeout(r, 1400));
        if (requestId !== generationRequestRef.current) return;
        sound.reveal();
        setState("RESULT");
        setBanner(null);
      } catch {
        if (requestId !== generationRequestRef.current) return;
        setState("DRAWING");
        setBanner("GENERATION FAILED — SKETCH PRESERVED");
        setTimeout(() => setBanner(null), 3000);
      }
    },
    [setState, sketchUrl],
  );

  const triggerReset = useCallback(() => {
    generationRequestRef.current++;
    strokesRef.current = [];
    redoStrokesRef.current = [];
    currentStrokeRef.current = null;
    drawingRef.current?.clear();
    setStrokeCount(0);
    setRedoCount(0);
    setResultUrl(null);
    if (sketchUrl) URL.revokeObjectURL(sketchUrl);
    setSketchUrl(null);
    setSelectedStyle(null);
    selectedStyleRef.current = null;
    setInkColor(INK);
    inkColorRef.current = INK;
    setToolState("pen");
    setShapeState(null);
    setShapePickerState(false);
    setPaletteState(false);
    setMenuState(false);
    setClearConfirming(false);
    clearConfirmingRef.current = false;
    setState("READY");
    setBanner(null);
  }, [
    setState,
    sketchUrl,
    setToolState,
    setShapeState,
    setShapePickerState,
    setPaletteState,
    setMenuState,
  ]);

  const toggleFullscreen = useCallback(() => {
    if (!document.fullscreenElement)
      document.documentElement.requestFullscreen();
    else document.exitFullscreen();
  }, []);

  const startCalibration = useCallback(() => {
    calSamplesRef.current = {
      minX: 1,
      maxX: 0,
      minY: 1,
      maxY: 0,
      startedAt: Date.now(),
      pinchDists: [],
      pinchCycles: 0,
      wasPinching: false,
    };
    calModeRef.current = "RANGE";
    setCalMode("RANGE");
    setCalProgress(0);
  }, []);

  const finishCalibration = useCallback(() => {
    const s = calSamplesRef.current;
    if (s.maxX > s.minX && s.maxY > s.minY) {
      const pinch =
        s.pinchDists.length >= 4
          ? computePinchThresholds(s.pinchDists)
          : { on: PINCH_ON, off: PINCH_OFF };
      const data: CalibrationData = {
        minX: s.minX,
        maxX: s.maxX,
        minY: s.minY,
        maxY: s.maxY,
        pinchOn: pinch.on,
        pinchOff: Math.max(pinch.off, pinch.on * 1.3),
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

  // Hit Testers
  const hitTest = useCallback((x: number, y: number): ButtonId | null => {
    for (const id of ["UNDO", "CLEAR", "GENERATE", "CLOSE"] as ButtonId[]) {
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
      const shape = shapePickerOpenRef.current ? hitTestShape(x, y) : null;
      if (shape) {
        if (now - lastShapeClickRef.current < BUTTON_DEBOUNCE_MS) return;
        lastShapeClickRef.current = now;
        sound.click();
        setShapeState(shape);
        setToolState("pen");
        setShapePickerState(false);
        return;
      }
      const color = paletteOpenRef.current ? hitTestColor(x, y) : null;
      if (color) {
        if (now - lastColorClickRef.current < BUTTON_DEBOUNCE_MS) return;
        lastColorClickRef.current = now;
        sound.click();
        setInkColor(color);
        inkColorRef.current = color;
        setPaletteState(false);
        return;
      }
      const style = menuOpenRef.current ? hitTestStyle(x, y) : null;
      if (style) {
        if (now - lastStyleClickRef.current < BUTTON_DEBOUNCE_MS) return;
        lastStyleClickRef.current = now;
        setSelectedStyle(style);
        selectedStyleRef.current = style;
        return;
      }
      const id = menuOpenRef.current ? hitTest(x, y) : null;
      if (!id) return;
      if (now - lastClickRef.current[id] < BUTTON_DEBOUNCE_MS) return;
      lastClickRef.current[id] = now;
      sound.click();
      if (id === "UNDO") triggerUndo();
      else if (id === "CLEAR") triggerClear();
      else if (id === "GENERATE") triggerGenerate();
      else if (id === "CLOSE") toggleMenu();
    },
    [
      hitTest,
      hitTestStyle,
      hitTestColor,
      hitTestShape,
      triggerUndo,
      triggerClear,
      triggerGenerate,
      toggleMenu,
      setPaletteState,
      setShapeState,
      setShapePickerState,
      setToolState,
    ],
  );

  // Stable Actions Ref for Keyboard Shortcuts
  const actionsRef = useRef({
    triggerGenerate,
    triggerUndo,
    triggerRedo,
    triggerClear,
    triggerReset,
    toggleFullscreen,
    startCalibration,
    cancelCalibration,
    togglePalette,
    toggleDrawMode,
    toggleAutoShape,
    toggleGlowMode,
    setBrushSizeState,
    handlePinchClick,
    setCameraPreviewOn,
    setDebugOn,
    setVoiceOn,
  });

  useEffect(() => {
    actionsRef.current = {
      triggerGenerate,
      triggerUndo,
      triggerRedo,
      triggerClear,
      triggerReset,
      toggleFullscreen,
      startCalibration,
      cancelCalibration,
      togglePalette,
      toggleDrawMode,
      toggleAutoShape,
      toggleGlowMode,
      setBrushSizeState,
      handlePinchClick,
      setCameraPreviewOn,
      setDebugOn,
      setVoiceOn,
    };
  }, [
    triggerGenerate,
    triggerUndo,
    triggerRedo,
    triggerClear,
    triggerReset,
    toggleFullscreen,
    startCalibration,
    cancelCalibration,
    togglePalette,
    toggleDrawMode,
    toggleAutoShape,
    toggleGlowMode,
    setBrushSizeState,
    handlePinchClick,
  ]);

  // Voice Controller
  useEffect(() => {
    const ctrl = voiceCtrl;
    if (voiceOn && voiceSupported()) {
      ctrl.start({
        onCommand: (cmd: VoiceCommand) => {
          const a = actionsRef.current;
          sound.click();
          switch (cmd.action) {
            case "generate":
              a.triggerGenerate(cmd.subject);
              setBanner(
                cmd.subject
                  ? `GENERATING "${cmd.subject.toUpperCase()}"`
                  : "VOICE COMMAND ✓",
              );
              break;
            case "undo":
              a.triggerUndo(true);
              break;
            case "clear":
              a.triggerClear();
              break;
            case "confirm":
              a.triggerClear();
              break;
            case "reset":
              a.triggerReset();
              break;
          }
        },
        onStatus: setVoiceListening,
        isClearConfirming: () => clearConfirmingRef.current,
      });
    } else {
      ctrl.stop();
    }
    return () => ctrl.stop();
  }, [voiceOn, voiceCtrl]);

  // Keyboard Shortcuts (Stage Crew Failsafes)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const a = actionsRef.current;
      switch (e.key.toLowerCase()) {
        case "g":
          a.triggerGenerate();
          break;
        case "z":
          if (e.ctrlKey || e.metaKey) {
            if (e.shiftKey) a.triggerRedo();
            else a.triggerUndo(true);
          } else {
            a.triggerUndo(true);
          }
          break;
        case "y":
          a.triggerRedo();
          break;
        case "1":
          a.setBrushSizeState(3);
          break;
        case "2":
          a.setBrushSizeState(6);
          break;
        case "3":
          a.setBrushSizeState(12);
          break;
        case "4":
          a.setBrushSizeState(22);
          break;
        case "n":
          a.toggleGlowMode();
          break;
        case "x":
          a.triggerClear(true);
          break;
        case "r":
          a.triggerReset();
          break;
        case "p":
          a.toggleDrawMode();
          break;
        case "a":
          a.toggleAutoShape();
          break;
        case "c":
          a.setCameraPreviewOn((v) => !v);
          break;
        case "d":
          a.setDebugOn((v) => !v);
          break;
        case "f":
          a.toggleFullscreen();
          break;
        case "s":
          sound.toggle();
          break;
        case "v":
          a.togglePalette();
          break;
        case "m":
          a.setVoiceOn((v) => !v);
          break;
        case "b":
          if (calModeRef.current) a.cancelCalibration();
          else if (
            stateRef.current === "READY" ||
            stateRef.current === "DRAWING"
          )
            a.startCalibration();
          break;
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // Main Loop
  useEffect(() => {
    let cancelled = false;
    let fpsCount = 0;
    let lastFpsTime = performance.now();

    async function init() {
      setState("INITIALIZING");
      let landmarker: Awaited<ReturnType<typeof createHandLandmarker>>;
      try {
        landmarker = await createHandLandmarker();
      } catch {
        if (!cancelled) {
          setState("CAMERA_PERMISSION");
          setBanner("HAND TRACKING UNAVAILABLE — RELOAD TO RETRY");
        }
        return;
      }
      if (cancelled) {
        landmarker.close();
        return;
      }
      landmarkerRef.current = landmarker;

      setState("CAMERA_PERMISSION");
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: {
            width: { ideal: CAMERA.width },
            height: { ideal: CAMERA.height },
            facingMode: "user",
            frameRate: { ideal: 60, min: 30 },
          },
        });
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        videoRef.current!.srcObject = stream;
        setCameraStream(stream);
        await videoRef.current!.play();
      } catch {
        landmarker.close();
        landmarkerRef.current = null;
        if (!cancelled) {
          setState("CAMERA_PERMISSION");
          setBanner("CAMERA ACCESS DENIED — ALLOW CAMERA AND RELOAD");
        }
        return;
      }

      setState("READY");
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
      const frame = extractHandFrame(
        result,
        cw,
        ch,
        prevFrameRef.current,
        calRef.current,
      );
      const prev = prevFrameRef.current;
      prevFrameRef.current = frame;

      // Predictive Extrapolation untuk feel 120Hz/Zero Latency
      const projectedCursor = getExtrapolatedCursor(frame.cursor, 10);
      const vx = projectedCursor.x + canvasRect.left;
      const vy = projectedCursor.y + canvasRect.top;

      // Calibration Logic
      const calPhase = calModeRef.current;
      if (calPhase && frame.detected) {
        const s = calSamplesRef.current;
        if (calPhase === "RANGE") {
          s.minX = Math.min(s.minX, frame.rawIndex.x);
          s.maxX = Math.max(s.maxX, frame.rawIndex.x);
          s.minY = Math.min(s.minY, frame.rawIndex.y);
          s.maxY = Math.max(s.maxY, frame.rawIndex.y);
          const elapsed = Date.now() - s.startedAt;
          setCalProgress(Math.min(elapsed / 8000, 1));
          if (elapsed >= 8000) {
            calModeRef.current = "PINCH";
            setCalMode("PINCH");
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

      // Update Cursor Motion Values
      cursorX.set(vx);
      cursorY.set(vy);

      // Check Drawing Activity
      const isCurrentlyDrawing =
        frame.pinching || frame.isPointing || currentStrokeRef.current !== null;

      // Multi-finger Gestures (Suppressed completely while drawing)
      if (
        frame.detected &&
        stateRef.current === "DRAWING" &&
        !calModeRef.current &&
        !isCurrentlyDrawing
      ) {
        const raised = frame.fingerCount - (frame.thumbOut ? 1 : 0);
        const count = raised === 2 ? (frame.twoFingers ? 2 : 0) : raised;
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
              const next: ToolId =
                toolRef.current === "eraser" ? "pen" : "eraser";
              setToolState(next);
              setShapeState(null);
              setBanner(next === "eraser" ? "ERASER ON" : "PEN ON");
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

      // FPS & Debug Frame Tracking
      fpsCount++;
      const now = performance.now();
      if (now - lastFpsTime >= 1000) {
        setFps(fpsCount * (1000 / (now - lastFpsTime)));
        setDebugFrame(frame);
        fpsCount = 0;
        lastFpsTime = now;
      }

      // Diffed HUD & Gesture States (Prevents 60 FPS React state updates)
      if (isPinchingRef.current !== frame.pinching) {
        isPinchingRef.current = frame.pinching;
        setIsPinching(frame.pinching);
      }
      if (activeGestureRef.current !== frame.activeGesture) {
        activeGestureRef.current = frame.activeGesture;
        setActiveGesture(frame.activeGesture);
      }
      if (isPointingRef.current !== frame.isPointing) {
        isPointingRef.current = frame.isPointing;
        setIsPointing(frame.isPointing);
      }

      // State Transition: Hand Appears
      if (stateRef.current === "READY" && frame.detected) {
        setState("DRAWING");
        setBanner(null);
        sound.trackingOn();
      }

      // 60 FPS Landmark Pipeline via Ref (No React state update!)
      landmarksRef.current = frame.detected ? frame.landmarks : undefined;

      handLostFramesRef.current = frame.detected
        ? 0
        : handLostFramesRef.current + 1;
      const handLost = handLostFramesRef.current > HAND_LOST_GRACE_FRAMES;
      if (
        stateRef.current === "DRAWING" &&
        handLost &&
        currentStrokeRef.current
      ) {
        strokesRef.current.push(currentStrokeRef.current);
        currentStrokeRef.current = null;
        setStrokeCount(strokesRef.current.length);
      }

      if (calModeRef.current) {
        rafRef.current = requestAnimationFrame(loop);
        return;
      }

      // GATED Hit-Testing: ONLY evaluate controls if respective overlays are ACTIVE
      const btnHit = menuOpenRef.current ? hitTest(vx, vy) : null;
      const styleHit = menuOpenRef.current ? hitTestStyle(vx, vy) : null;
      const colorHit = paletteOpenRef.current ? hitTestColor(vx, vy) : null;
      const shapeHit = shapePickerOpenRef.current ? hitTestShape(vx, vy) : null;
      const overControl =
        btnHit !== null ||
        styleHit !== null ||
        colorHit !== null ||
        shapeHit !== null;

      // Diffed Hover States Update
      if (hoveredButtonRef.current !== btnHit) {
        hoveredButtonRef.current = btnHit;
        setHoveredButton(btnHit);
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

      // Drawing Active Check (Smart Dual Mode / Air Pen / Pinch Only)
      const isPenActive =
        drawModeRef.current === "smart"
          ? frame.pinching || frame.isPointing
          : drawModeRef.current === "point"
            ? frame.isPointing
            : frame.pinching;

      // Canvas Drawing Logic
      if (
        stateRef.current === "DRAWING" &&
        frame.detected &&
        !handLost &&
        !overControl &&
        !menuOpenRef.current &&
        !paletteOpenRef.current &&
        !shapePickerOpenRef.current
      ) {
        const ctx = drawing.getCtx();
        if (isPenActive) {
          pinchReleasedFramesRef.current = 0;
          if (!currentStrokeRef.current) {
            currentStrokeRef.current = {
              points: [frame.cursor],
              width:
                toolRef.current === "eraser"
                  ? eraserWidthRef.current
                  : brushSizeRef.current,
              color:
                toolRef.current === "eraser" ? "#ffffff" : inkColorRef.current,
              shape:
                toolRef.current === "eraser"
                  ? undefined
                  : (activeShapeRef.current ?? undefined),
              tool: toolRef.current,
              glow: glowModeRef.current && toolRef.current !== "eraser",
            };
            redoStrokesRef.current = [];
            setRedoCount(0);
            lastDrawnIndexRef.current = 0;
          } else {
            const stroke = currentStrokeRef.current;
            const committed = applyPenDeadzone(
              frame.cursor,
              stroke.points[stroke.points.length - 1],
            );
            if (committed) {
              stroke.points.push(committed);
              if (ctx) {
                if (stroke.shape) {
                  const [cw, ch] = drawing.size();
                  redrawAll(ctx, [...strokesRef.current, stroke], cw, ch);
                } else {
                  drawStrokeSegment(ctx, stroke, lastDrawnIndexRef.current);
                }
                drawing.spawnParticles(frame.cursor.x, frame.cursor.y, stroke.color);
              }
              lastDrawnIndexRef.current = stroke.points.length - 1;
            }
          }
        } else if (currentStrokeRef.current) {
          pinchReleasedFramesRef.current++;
          if (pinchReleasedFramesRef.current > PINCH_RELEASE_GRACE_FRAMES) {
            const stroke = currentStrokeRef.current;
            // Magic Shape Recognition & Snapping
            if (
              autoShapeRef.current &&
              !stroke.shape &&
              stroke.tool !== "eraser" &&
              stroke.points.length >= 8
            ) {
              const recognized = recognizeShape(stroke.points);
              if (recognized && recognized.confidence >= 0.75) {
                stroke.points = recognized.points;
                stroke.shape = recognized.type;
                stroke.recognizedAs = recognized.type;
                sound.click();
                setDetectedShapeToast(`${recognized.label} Detected`);
                if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
                toastTimerRef.current = setTimeout(
                  () => setDetectedShapeToast(null),
                  2500,
                );
              }
            }
            strokesRef.current.push(stroke);
            currentStrokeRef.current = null;
            pinchReleasedFramesRef.current = 0;
            if (ctx) {
              const [cw, ch] = drawing.size();
              redrawAll(ctx, strokesRef.current, cw, ch);
            }
            setStrokeCount(strokesRef.current.length);
          }
        }
      } else if (frame.detected && !handLost && currentStrokeRef.current) {
        strokesRef.current.push(currentStrokeRef.current);
        currentStrokeRef.current = null;
        setStrokeCount(strokesRef.current.length);
      }

      // Pinch Click & Dwell Logic
      if (frame.detected) {
        if (frame.pinching && !prev?.pinching) {
          actionsRef.current.handlePinchClick(vx, vy);
        }

        const dwellId = btnHit ?? styleHit ?? colorHit ?? shapeHit;
        if (dwellId) {
          if (dwellRef.current.id !== dwellId) {
            dwellRef.current = { id: dwellId, since: Date.now() };
          } else if (Date.now() - dwellRef.current.since >= DWELL_CLICK_MS) {
            dwellRef.current = { id: dwellId, since: Number.POSITIVE_INFINITY };
            actionsRef.current.handlePinchClick(vx, vy);
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
      if (clearTimerRef.current) clearTimeout(clearTimerRef.current);
      if (undoTimerRef.current) clearTimeout(undoTimerRef.current);
      if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
      (video?.srcObject as MediaStream | null)
        ?.getTracks()
        .forEach((t) => t.stop());
      landmarkerRef.current?.close();
    };
  }, [
    setState,
    cursorX,
    cursorY,
    hitTest,
    hitTestStyle,
    hitTestColor,
    hitTestShape,
    togglePalette,
    setShapePickerState,
    setToolState,
    setShapeState,
    toggleMenu,
    finishCalibration,
  ]);

  useEffect(() => {
    return () => {
      if (sketchUrl) URL.revokeObjectURL(sketchUrl);
    };
  }, [sketchUrl]);

  const isDrawing =
    drawMode === "smart"
      ? isPinching || isPointing
      : drawMode === "point"
        ? isPointing
        : isPinching;

  const cursorState: CursorState =
    hoveredButton || hoveredStyle || hoveredColor || hoveredShape
      ? "hover"
      : isDrawing
        ? isPointing
          ? "point"
          : "pinch"
        : activeGesture === "fist"
          ? "neutral"
          : "normal";

  return (
    <div className="relative h-screen w-screen overflow-hidden bg-[#050510]">
      <video ref={videoRef} autoPlay playsInline muted className="hidden" />

      <DrawingCanvas ref={drawingRef} />

      {appState === "DRAWING" && (
        <>
          <GestureHUD
            gesture={activeGesture}
            isDrawing={isDrawing}
            drawMode={drawMode}
            autoShape={autoShape}
            activeShape={activeShape}
            detectedShapeToast={detectedShapeToast}
            brushSize={brushSize}
            glowMode={glowMode}
            canUndo={strokeCount > 0}
            canRedo={redoCount > 0}
            tool={tool}
            paletteOpen={paletteOpen}
            shapePickerOpen={shapePickerOpen}
            onToggleDrawMode={toggleDrawMode}
            onToggleAutoShape={toggleAutoShape}
            onSelectBrushSize={setBrushSizeState}
            onToggleGlow={toggleGlowMode}
            onTogglePalette={togglePalette}
            onToggleShapePicker={() => setShapePickerState(!shapePickerOpenRef.current)}
            onUndo={() => triggerUndo(true)}
            onRedo={() => triggerRedo()}
            onClear={() => triggerClear()}
          />
          {paletteOpen && (
            <ColorPicker
              selected={inkColor}
              hovered={hoveredColor}
              registerRect={(color, rect) => {
                colorRectsRef.current[color] = rect;
              }}
            />
          )}
          {shapePickerOpen && (
            <ShapePicker
              selected={activeShape}
              hovered={hoveredShape}
              registerRect={(shape, rect) => {
                shapeRectsRef.current[shape] = rect;
              }}
            />
          )}
          {(tool === "eraser" || activeShape) && (
            <div className="pointer-events-none absolute left-1/2 top-6 z-30 -translate-x-1/2 flex items-center gap-2 rounded-2xl bg-slate-950/85 px-4 py-2 text-xs font-black tracking-[0.2em] text-cyan-200 border border-cyan-400/40 backdrop-blur-2xl shadow-[0_8px_32px_rgba(0,0,0,0.6),0_0_20px_rgba(0,240,255,0.25)]">
              <span>{tool === "eraser" ? "🧹" : "📐"}</span>
              <span>
                {tool === "eraser"
                  ? "ERASER ON (4 FINGERS TO PEN)"
                  : `${activeShape?.toUpperCase()} MODE`}
              </span>
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
              registerRect={(id, rect) => {
                buttonRectsRef.current[id] = rect;
              }}
              registerStyleRect={(key, rect) => {
                styleRectsRef.current[key] = rect;
              }}
            />
          )}
        </>
      )}

      {appState === "RESULT" && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.9 }}
          className="absolute inset-0 z-20 flex flex-col items-center justify-center gap-10 bg-[#050510]"
        >
          <h2 className="text-5xl font-black tracking-widest text-white">
            FROM IMAGINATION TO CREATION
          </h2>
          <div className="flex items-center gap-16">
            <div className="text-center">
              <p className="mb-3 text-sm tracking-[0.3em] text-slate-400">
                YOUR SKETCH
              </p>
              {sketchUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={sketchUrl}
                  alt="Sketch"
                  className="h-[270px] w-[360px] rounded-2xl object-contain border border-white/15 bg-white shadow-2xl"
                />
              ) : (
                <div className="h-[270px] w-[360px] rounded-2xl bg-white/5" />
              )}
            </div>
            <div className="text-4xl text-cyan-400">→</div>
            <div className="text-center">
              <p className="mb-3 text-sm tracking-[0.3em] text-cyan-300">
                AI CREATION
              </p>
              {resultUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={resultUrl}
                  alt="AI generated"
                  className="h-[270px] w-[360px] rounded-2xl object-cover border border-cyan-400/40 shadow-[0_0_30px_rgba(0,240,255,0.3)]"
                />
              ) : (
                <div className="h-[270px] w-[360px] rounded-2xl bg-white/5" />
              )}
            </div>
          </div>
          <button
            onClick={triggerReset}
            className="mt-4 rounded-2xl bg-gradient-to-r from-cyan-500/20 to-purple-500/20 px-12 py-5 text-2xl font-black tracking-widest text-white ring-1 ring-cyan-300/40 shadow-[0_0_25px_rgba(0,240,255,0.2)] transition hover:scale-105 hover:bg-white/20 active:scale-95"
          >
            START AGAIN
          </button>
        </motion.div>
      )}

      {(appState === "CAPTURE" || appState === "GENERATING") && (
        <LoadingExperience />
      )}

      {calMode && (
        <CalibrationOverlay
          phase={calMode}
          progress={calProgress}
          onCancel={cancelCalibration}
        />
      )}

      <HandCursor
        x={cursorX}
        y={cursorY}
        state={cursorState}
        color={inkColor}
        tool={tool}
      />

      <StatusBanner state={appState} custom={banner} />

      {debugOn && (
        <DebugPanel
          fps={fps}
          frame={debugFrame}
          state={appState}
          strokeCount={strokeCount}
        />
      )}

      {cameraPreviewOn && appState !== "RESULT" && (
        <CameraPreview stream={cameraStream} landmarksRef={landmarksRef} />
      )}

      {voiceOn && (
        <div className="pointer-events-none absolute right-5 top-5 z-40 flex items-center gap-2 rounded-full bg-black/60 px-4 py-2 text-sm font-semibold tracking-wider text-white ring-1 ring-white/20">
          <span
            className={`h-2.5 w-2.5 rounded-full ${voiceListening ? "animate-pulse bg-emerald-400" : "bg-red-400"}`}
          />
          {voiceListening ? "LISTENING" : "MIC OFF"}
        </div>
      )}
    </div>
  );
}