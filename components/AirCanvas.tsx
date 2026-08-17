'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { motion, useMotionValue } from 'framer-motion';
import { createHandLandmarker, extractHandFrame } from '@/lib/hand-tracking';
import { drawStrokeSegment } from '@/lib/strokes';
import { CAMERA, BUTTON_DEBOUNCE_MS, CLEAR_CONFIRM_TIMEOUT_MS, INK, STROKE_WIDTH } from '@/lib/constants';
import type { AppState, ButtonId, HandFrame, Stroke } from '@/lib/types';
import DrawingCanvas, { type DrawingCanvasHandle } from './DrawingCanvas';
import HandCursor, { type CursorState } from './HandCursor';
import ButtonBar from './ButtonBar';
import StatusBanner from './StatusBanner';
import DebugPanel from './DebugPanel';
import CameraPreview from './CameraPreview';
import LoadingExperience from './LoadingExperience';
import StylePicker from './StylePicker';
import { STYLES, type StyleKey } from '@/lib/prompt';
import { sound } from '@/lib/sound';
import {
  effectiveCalibration,
  saveCalibration,
  computePinchThresholds,
  type CalibrationData,
} from '@/lib/calibration';
import { PINCH_ON, PINCH_OFF } from '@/lib/constants';
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
  });
  const lastClickRef = useRef<Record<ButtonId, number>>({ UNDO: 0, CLEAR: 0, GENERATE: 0 });
  const clearTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const styleRectsRef = useRef<Partial<Record<StyleKey, DOMRect | null>>>({});
  const lastStyleClickRef = useRef(0);

  // MotionValues — cursor position updates without React re-render
  const cursorX = useMotionValue(0);
  const cursorY = useMotionValue(0);

  const setState = useCallback((s: AppState) => {
    stateRef.current = s;
    setAppState(s);
  }, []);

  // ─── Actions ────────────────────────────────────────────────────────────────

  const triggerUndo = useCallback(() => {
    if (stateRef.current !== 'DRAWING') return;
    strokesRef.current.pop();
    drawingRef.current?.redraw(strokesRef.current);
    setStrokeCount(strokesRef.current.length);
  }, []);

  const executeClear = useCallback(() => {
    strokesRef.current = [];
    currentStrokeRef.current = null;
    drawingRef.current?.clear();
    setStrokeCount(0);
    setClearConfirming(false);
  }, []);

  const triggerClear = useCallback((skipConfirm = false) => {
    if (stateRef.current !== 'DRAWING') return;
    if (skipConfirm || clearConfirming) {
      executeClear();
      return;
    }
    setClearConfirming(true);
    if (clearTimerRef.current) clearTimeout(clearTimerRef.current);
    clearTimerRef.current = setTimeout(() => setClearConfirming(false), CLEAR_CONFIRM_TIMEOUT_MS);
  }, [clearConfirming, executeClear]);

  const triggerGenerate = useCallback(async () => {
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
    setClearConfirming(false);
    setState('READY');
    setBanner(null);
  }, [setState, sketchUrl]);

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
        pinchOn: pinch.on, pinchOff: Math.max(pinch.off, pinch.on + 0.005),
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
    for (const id of ['UNDO', 'CLEAR', 'GENERATE'] as ButtonId[]) {
      const rect = buttonRectsRef.current[id];
      if (rect && x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom) {
        return id;
      }
    }
    return null;
  }, []);

  const hitTestStyle = useCallback((x: number, y: number): StyleKey | null => {
    for (const key of Object.keys(STYLES) as StyleKey[]) {
      const rect = styleRectsRef.current[key];
      if (rect && x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom) {
        return key;
      }
    }
    return null;
  }, []);

  const handlePinchClick = useCallback(
    (x: number, y: number) => {
      const now = Date.now();
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
    },
    [hitTest, hitTestStyle, triggerUndo, triggerClear, triggerGenerate]
  );

  // ─── Keyboard failsafes ─────────────────────────────────────────────────────

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      switch (e.key.toLowerCase()) {
        case 'g': triggerGenerate(); break;
        case 'z': triggerUndo(); break;
        case 'x': triggerClear(true); break;
        case 'r': triggerReset(); break;
        case 'c': setCameraPreviewOn(v => !v); break;
        case 'd': setDebugOn(v => !v); break;
        case 'f': toggleFullscreen(); break;
        case 's': sound.toggle(); break;
        case 'b':
          if (calModeRef.current) cancelCalibration();
          else if (stateRef.current === 'READY' || stateRef.current === 'DRAWING') startCalibration();
          break;
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [triggerGenerate, triggerUndo, triggerClear, triggerReset, toggleFullscreen, startCalibration, cancelCalibration]);

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
      if (stateRef.current === 'DRAWING' && !frame.detected) {
        // Hand lost mid-drawing — finish current stroke, stay in DRAWING
        if (currentStrokeRef.current) {
          strokesRef.current.push(currentStrokeRef.current);
          currentStrokeRef.current = null;
          setStrokeCount(strokesRef.current.length);
        }
      }

      // Suppress drawing during calibration
      if (calModeRef.current) {
        rafRef.current = requestAnimationFrame(loop);
        return;
      }

      // Suppress drawing while the cursor is over a virtual control
      const overControl =
        hitTest(vx, vy) !== null ||
        hitTestStyle(vx, vy) !== null;

      // Drawing
      if (stateRef.current === 'DRAWING' && frame.detected && !overControl) {
        const ctx = drawing.getCtx();
        if (frame.pinching) {
          if (!currentStrokeRef.current) {
            currentStrokeRef.current = { points: [frame.cursor], width: STROKE_WIDTH, color: INK };
            lastDrawnIndexRef.current = 0;
          } else {
            currentStrokeRef.current.points.push(frame.cursor);
            if (ctx) drawStrokeSegment(ctx, currentStrokeRef.current, lastDrawnIndexRef.current);
            lastDrawnIndexRef.current = currentStrokeRef.current.points.length - 1;
          }
        } else if (currentStrokeRef.current) {
          strokesRef.current.push(currentStrokeRef.current);
          currentStrokeRef.current = null;
          setStrokeCount(strokesRef.current.length);
        }
      } else if (currentStrokeRef.current) {
        // Cursor left the canvas area or moved over a control — commit the stroke
        strokesRef.current.push(currentStrokeRef.current);
        currentStrokeRef.current = null;
        setStrokeCount(strokesRef.current.length);
      }

      // Button hover + click (viewport coords vs DOM rects)
      if (frame.detected) {
        setHoveredButton(hitTest(vx, vy));
        setHoveredStyle(hitTestStyle(vx, vy));
        // Rising edge only — prevents re-trigger while holding pinch to draw
        if (frame.pinching && !prev?.pinching) {
          handlePinchClick(vx, vy);
        }
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
  }, [setState, cursorX, cursorY, hitTest, hitTestStyle, handlePinchClick, finishCalibration]);

  // ─── Cursor visual state ────────────────────────────────────────────────────

  const cursorState: CursorState =
    hoveredButton || hoveredStyle ? 'hover' : isPinching ? 'pinch' : 'normal';

  // ─── Render ─────────────────────────────────────────────────────────────────

  return (
    <div className="relative h-screen w-screen overflow-hidden bg-[#050510]">
      {/* Hidden video element for MediaPipe */}
      <video ref={videoRef} autoPlay playsInline muted className="hidden" />

      {/* Drawing canvas */}
      <DrawingCanvas ref={drawingRef} />

      {/* Controls */}
      {appState === 'DRAWING' && (
        <>
          <StylePicker
            selected={selectedStyle}
            hovered={hoveredStyle}
            registerRect={(key, rect) => { styleRectsRef.current[key] = rect; }}
          />
          <ButtonBar
            hovered={hoveredButton}
            clearConfirming={clearConfirming}
            generateDisabled={strokeCount === 0}
            onUndo={triggerUndo}
            onClear={() => triggerClear()}
            onGenerate={triggerGenerate}
            registerRect={(id, rect) => { buttonRectsRef.current[id] = rect; }}
          />
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
      <HandCursor x={cursorX} y={cursorY} state={cursorState} />

      {/* Status */}
      <StatusBanner state={appState} custom={banner} />

      {/* Debug */}
      {debugOn && (
        <DebugPanel fps={fps} frame={debugFrame} state={appState} strokeCount={strokeCount} />
      )}

      {/* Camera preview pip */}
      {cameraPreviewOn && appState !== 'RESULT' && <CameraPreview stream={cameraStream} />}
    </div>
  );
}
