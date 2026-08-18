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
  ONE_EURO_MIN_CUTOFF,
  ONE_EURO_BETA,
  ONE_EURO_D_CUTOFF,
} from './constants';
import { normalizedPinchDistance } from './geometry';
import { mapWithCalibration, type CalibrationData } from './calibration';
import { OneEuroFilter } from './one-euro';
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
const MIDDLE_MCP = 9;

function dist(a: NormalizedLandmark, b: NormalizedLandmark): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

/** A finger is extended when its tip is farther from the wrist than its PIP joint. */
function extended(lm: NormalizedLandmark[], tip: number, pip: number): boolean {
  return dist(lm[tip], lm[WRIST]) > dist(lm[pip], lm[WRIST]) * 1.05;
}

/** Count extended fingers (index/middle/ring/pinky). Thumb excluded — it's the pinch finger. */
function countFingers(lm: NormalizedLandmark[]): number {
  let n = 0;
  if (extended(lm, INDEX_TIP, INDEX_PIP)) n++;
  if (extended(lm, MIDDLE_TIP, MIDDLE_PIP)) n++;
  if (extended(lm, RING_TIP, RING_PIP)) n++;
  if (extended(lm, PINKY_TIP, PINKY_PIP)) n++;
  return n;
}

/**
 * Two-finger gesture: index + middle extended, ring + pinky curled.
 * Used to open the color palette on the canvas.
 */
function detectTwoFingers(count: number, lm: NormalizedLandmark[]): boolean {
  if (count !== 2) return false;
  // Must be index + middle specifically, not any two
  return extended(lm, INDEX_TIP, INDEX_PIP) && extended(lm, MIDDLE_TIP, MIDDLE_PIP);
}

// ponytail: module-level filters assume a single presenter (numHands: 1);
// move to per-instance state if multi-hand ever lands.
const filterX = new OneEuroFilter(ONE_EURO_MIN_CUTOFF, ONE_EURO_BETA, ONE_EURO_D_CUTOFF);
const filterY = new OneEuroFilter(ONE_EURO_MIN_CUTOFF, ONE_EURO_BETA, ONE_EURO_D_CUTOFF);

/** Create the MediaPipe Hand Landmarker. Falls back GPU -> CPU silently. */
export async function createHandLandmarker(): Promise<HandLandmarker> {
  const vision = await FilesetResolver.forVisionTasks(WASM_BASE);
  const options = (delegate: 'GPU' | 'CPU') => ({
    baseOptions: { modelAssetPath: MODEL_URL, delegate },
    numHands: 1,
    minHandDetectionConfidence: 0.5,
    minHandPresenceConfidence: 0.5,
    // Looser tracking confidence: keeps the landmark stream alive through
    // fast sweeps and brief self-occlusion instead of dropping frames.
    minTrackingConfidence: 0.3,
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
    // Hand left — reset so re-acquire doesn't interpolate a giant jump
    filterX.reset();
    filterY.reset();
    return {
      detected: false,
      cursor: prev?.cursor ?? { x: canvasW / 2, y: canvasH / 2 },
      rawIndex: prev?.rawIndex ?? { x: 0.5, y: 0.5 },
      rawThumb: prev?.rawThumb ?? { x: 0.5, y: 0.5 },
      pinchDist: prev?.pinchDist ?? 1,
      pinching: false,
      twoFingers: false,
      fingerCount: 0,
    };
  }

  const rawIndex: Point = { x: landmarks[INDEX_TIP].x, y: landmarks[INDEX_TIP].y };
  const rawThumb: Point = { x: landmarks[THUMB_TIP].x, y: landmarks[THUMB_TIP].y };
  // Hand-size-normalized so pinch state doesn't flicker when the presenter
  // moves closer to / farther from the camera mid-stroke.
  const dist = normalizedPinchDistance(
    rawThumb,
    rawIndex,
    { x: landmarks[WRIST].x, y: landmarks[WRIST].y },
    { x: landmarks[MIDDLE_MCP].x, y: landmarks[MIDDLE_MCP].y }
  );

  // Hysteresis: different thresholds for activation vs release
  const pinching = prev?.pinching ? dist < cal.pinchOff : dist < cal.pinchOn;

  // One-Euro Filter in pixel space: heavy smoothing at rest (no shake),
  // light smoothing at speed (no lag). Filter after mapping so beta's units
  // match the drawing space.
  const target = mapWithCalibration(rawIndex.x, rawIndex.y, canvasW, canvasH, cal);
  const cursor = {
    x: filterX.filter(target.x, performance.now()),
    y: filterY.filter(target.y, performance.now()),
  };

  const fingerCount = countFingers(landmarks);
  const twoFingers = detectTwoFingers(fingerCount, landmarks);

  return { detected: true, cursor, rawIndex, rawThumb, pinchDist: dist, pinching, twoFingers, fingerCount };
}
