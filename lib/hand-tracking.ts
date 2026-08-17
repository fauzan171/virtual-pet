import {
  FilesetResolver,
  HandLandmarker,
  type HandLandmarkerResult,
} from '@mediapipe/tasks-vision';
import {
  MODEL_URL,
  WASM_BASE,
  INDEX_TIP,
  THUMB_TIP,
  SMOOTHING,
  SMOOTHING_FAST,
  FAST_MOVE_THRESHOLD,
  DEAD_ZONE,
  RAW_ANCHOR_THRESHOLD,
} from './constants';
import { smoothAdaptive, pinchDistance } from './geometry';
import { mapWithCalibration, type CalibrationData } from './calibration';
import type { HandFrame, Point } from './types';
import type { NormalizedLandmark } from '@mediapipe/tasks-vision';

// Landmark indices for finger extension detection (tip vs PIP joint)
const WRIST = 0;
const INDEX_PIP = 6;
const MIDDLE_TIP = 12;
const MIDDLE_PIP = 10;
const RING_TIP = 16;
const RING_PIP = 14;
const PINKY_TIP = 20;
const PINKY_PIP = 18;

function dist(a: NormalizedLandmark, b: NormalizedLandmark): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

/** A finger is extended when its tip is farther from the wrist than its PIP joint. */
function extended(lm: NormalizedLandmark[], tip: number, pip: number): boolean {
  return dist(lm[tip], lm[WRIST]) > dist(lm[pip], lm[WRIST]) * 1.05;
}

/**
 * Two-finger gesture: index + middle extended, ring + pinky curled.
 * Used to open the color palette on the canvas.
 */
function detectTwoFingers(lm: NormalizedLandmark[]): boolean {
  const index = extended(lm, INDEX_TIP, INDEX_PIP);
  const middle = extended(lm, MIDDLE_TIP, MIDDLE_PIP);
  const ring = extended(lm, RING_TIP, RING_PIP);
  const pinky = extended(lm, PINKY_TIP, PINKY_PIP);
  return index && middle && !ring && !pinky;
}

/** Create the MediaPipe Hand Landmarker. Falls back GPU -> CPU silently. */
export async function createHandLandmarker(): Promise<HandLandmarker> {
  const vision = await FilesetResolver.forVisionTasks(WASM_BASE);
  const options = (delegate: 'GPU' | 'CPU') => ({
    baseOptions: { modelAssetPath: MODEL_URL, delegate },
    numHands: 1,
    minHandDetectionConfidence: 0.5,
    minHandPresenceConfidence: 0.5,
    minTrackingConfidence: 0.5,
    runningMode: 'VIDEO' as const,
  });

  try {
    return await HandLandmarker.createFromOptions(vision, options('GPU'));
  } catch {
    console.warn('GPU delegate failed, falling back to CPU');
    return await HandLandmarker.createFromOptions(vision, options('CPU'));
  }
}

/**
 * Pure per-frame extraction. Reads landmark 8 (index tip) and 4 (thumb tip),
 * applies calibrated region mapping, mirror, smoothing, and pinch hysteresis.
 */
export function extractHandFrame(
  result: HandLandmarkerResult,
  canvasW: number,
  canvasH: number,
  prev: HandFrame | null,
  cal: CalibrationData
): HandFrame {
  const landmarks = result.landmarks?.[0];
  if (!landmarks) {
    return {
      detected: false,
      cursor: prev?.cursor ?? { x: canvasW / 2, y: canvasH / 2 },
      rawIndex: prev?.rawIndex ?? { x: 0.5, y: 0.5 },
      rawThumb: prev?.rawThumb ?? { x: 0.5, y: 0.5 },
      pinchDist: prev?.pinchDist ?? 1,
      pinching: false,
      twoFingers: false,
    };
  }

  const rawIndex: Point = { x: landmarks[INDEX_TIP].x, y: landmarks[INDEX_TIP].y };
  const rawThumb: Point = { x: landmarks[THUMB_TIP].x, y: landmarks[THUMB_TIP].y };
  const dist = pinchDistance(rawIndex, rawThumb);

  // Hysteresis: different thresholds for activation vs release
  const pinching = prev?.pinching ? dist < cal.pinchOff : dist < cal.pinchOn;

  // Anchor: the target only updates when the raw fingertip moves past the
  // threshold from the last accepted position. A still hand holds its anchor,
  // and the cursor freezes entirely — no smoothing creep, no tremor drift.
  const prevAnchor = prev?.anchor ?? rawIndex;
  const rawMove = Math.hypot(rawIndex.x - prevAnchor.x, rawIndex.y - prevAnchor.y);
  const still = rawMove <= RAW_ANCHOR_THRESHOLD;
  const anchor = still ? prevAnchor : rawIndex;

  const target = mapWithCalibration(anchor.x, anchor.y, canvasW, canvasH, cal);
  const cursor = prev
    ? smoothAdaptive(prev.cursor, target, SMOOTHING, SMOOTHING_FAST, FAST_MOVE_THRESHOLD, DEAD_ZONE, still)
    : target;

  const twoFingers = detectTwoFingers(landmarks);

  return { detected: true, cursor, rawIndex, rawThumb, pinchDist: dist, pinching, twoFingers, anchor };
}
