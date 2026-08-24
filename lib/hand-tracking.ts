import {
  FilesetResolver,
  HandLandmarker,
  type HandLandmarkerResult,
  type NormalizedLandmark,
} from '@mediapipe/tasks-vision';
import {
  MODEL_URL,
  WASM_BASE,
  INDEX_MCP,
  INDEX_PIP,
  INDEX_DIP,
  INDEX_TIP,
  MIDDLE_MCP,
  MIDDLE_PIP,
  MIDDLE_DIP,
  MIDDLE_TIP,
  RING_MCP,
  RING_PIP,
  RING_DIP,
  RING_TIP,
  PINKY_MCP,
  PINKY_PIP,
  PINKY_DIP,
  PINKY_TIP,
  THUMB_MCP,
  THUMB_IP,
  THUMB_TIP,
  WRIST,
  ONE_EURO_MIN_CUTOFF,
  ONE_EURO_BETA,
  ONE_EURO_D_CUTOFF,
} from './constants';
import {
  normalizedPinchDistance,
  isFingerExtended,
  isThumbExtended,
} from './geometry';
import { mapWithCalibration, type CalibrationData } from './calibration';
import { OneEuroFilter } from './one-euro';
import type { HandFrame, Point, GestureType, LandmarkPoint } from './types';

// Global One-Euro Filter instances for continuous low-latency tracking
const filterX = new OneEuroFilter(ONE_EURO_MIN_CUTOFF, ONE_EURO_BETA, ONE_EURO_D_CUTOFF);
const filterY = new OneEuroFilter(ONE_EURO_MIN_CUTOFF, ONE_EURO_BETA, ONE_EURO_D_CUTOFF);

// Motion Vector State for 120Hz/144Hz Predictive Extrapolation
let lastRawX = 0;
let lastRawY = 0;
let lastTimestamp = 0;
let currentVelocity = { vx: 0, vy: 0 };

export async function createHandLandmarker(): Promise<HandLandmarker> {
  const vision = await FilesetResolver.forVisionTasks(WASM_BASE);
  const options = (delegate: 'GPU' | 'CPU') => ({
    baseOptions: { modelAssetPath: MODEL_URL, delegate },
    numHands: 1,
    minHandDetectionConfidence: 0.4,
    minHandPresenceConfidence: 0.4,
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
 * Extrapolates cursor coordinate ahead in time based on velocity vector
 * to match 120Hz/144Hz high-refresh displays with zero visual lag.
 */
export function getExtrapolatedCursor(baseCursor: Point, leadTimeMs: number = 10): Point {
  const dt = leadTimeMs / 1000;
  return {
    x: baseCursor.x + currentVelocity.vx * dt,
    y: baseCursor.y + currentVelocity.vy * dt,
  };
}

export function extractHandFrame(
  result: HandLandmarkerResult,
  canvasW: number,
  canvasH: number,
  prev: HandFrame | null,
  cal: CalibrationData
): HandFrame {
  const landmarks = result.landmarks?.[0];
  const now = performance.now();

  if (!landmarks || landmarks.length < 21) {
    filterX.reset();
    filterY.reset();
    currentVelocity = { vx: 0, vy: 0 };
    lastTimestamp = now;

    return {
      detected: false,
      cursor: prev?.cursor ?? { x: canvasW / 2, y: canvasH / 2 },
      rawIndex: prev?.rawIndex ?? { x: 0.5, y: 0.5 },
      rawThumb: prev?.rawThumb ?? { x: 0.5, y: 0.5 },
      pinchDist: prev?.pinchDist ?? 1,
      pinching: false,
      isPointing: false,
      twoFingers: false,
      threeFingers: false,
      openPalm: false,
      fist: false,
      activeGesture: 'hover',
      fingerCount: 0,
      thumbOut: false,
      landmarks: undefined,
    };
  }

  const rawIndex: Point = { x: landmarks[INDEX_TIP].x, y: landmarks[INDEX_TIP].y };
  const rawThumb: Point = { x: landmarks[THUMB_TIP].x, y: landmarks[THUMB_TIP].y };

  const pinchDist = normalizedPinchDistance(
    rawThumb,
    rawIndex,
    landmarks[WRIST],
    landmarks[MIDDLE_MCP]
  );

  const pinching = prev?.pinching ? pinchDist < cal.pinchOff : pinchDist < cal.pinchOn;

  // Individual finger 3D extension states
  const indexExt = isFingerExtended(landmarks, INDEX_MCP, INDEX_PIP, INDEX_DIP, INDEX_TIP, WRIST);
  const middleExt = isFingerExtended(landmarks, MIDDLE_MCP, MIDDLE_PIP, MIDDLE_DIP, MIDDLE_TIP, WRIST);
  const ringExt = isFingerExtended(landmarks, RING_MCP, RING_PIP, RING_DIP, RING_TIP, WRIST);
  const pinkyExt = isFingerExtended(landmarks, PINKY_MCP, PINKY_PIP, PINKY_DIP, PINKY_TIP, WRIST);
  const thumbExt = isThumbExtended(
    landmarks,
    THUMB_TIP,
    THUMB_MCP,
    PINKY_MCP,
    WRIST,
    THUMB_IP,
    INDEX_MCP,
    MIDDLE_MCP
  );

  let fingerCount = 0;
  if (thumbExt) fingerCount++;
  if (indexExt) fingerCount++;
  if (middleExt) fingerCount++;
  if (ringExt) fingerCount++;
  if (pinkyExt) fingerCount++;

  // Gestures Identification
  const isPointing = indexExt && !middleExt && !ringExt && !pinkyExt;
  const twoFingers = indexExt && middleExt && !ringExt && !pinkyExt;
  const threeFingers =
    (indexExt && middleExt && ringExt && !pinkyExt) ||
    (thumbExt && indexExt && middleExt && !ringExt && !pinkyExt);
  const openPalm = fingerCount >= 4 || (indexExt && middleExt && ringExt && pinkyExt);
  const allFourCurled = !indexExt && !middleExt && !ringExt && !pinkyExt;
  const fist = allFourCurled && !pinching && !isPointing;

  let activeGesture: GestureType = 'hover';
  if (pinching) {
    activeGesture = 'pinch';
  } else if (isPointing) {
    activeGesture = 'point';
  } else if (twoFingers) {
    activeGesture = 'peace';
  } else if (threeFingers) {
    activeGesture = 'three';
  } else if (openPalm) {
    activeGesture = 'open';
  } else if (fist) {
    activeGesture = 'fist';
  }

  // Anchor target coordinate selection
  let targetRawX = rawIndex.x;
  let targetRawY = rawIndex.y;

  if (pinching) {
    // Midpoint between Index and Thumb
    targetRawX = (rawIndex.x * 0.6) + (rawThumb.x * 0.4);
    targetRawY = (rawIndex.y * 0.6) + (rawThumb.y * 0.4);
  } else if (fist) {
    // Rest on index knuckle (MCP) for stability
    targetRawX = landmarks[INDEX_MCP].x;
    targetRawY = landmarks[INDEX_MCP].y;
  }

  // Map to Canvas bounds via calibration
  const target = mapWithCalibration(targetRawX, targetRawY, canvasW, canvasH, cal);

  // Filter raw target through One-Euro Filter
  const filteredX = filterX.filter(target.x, now);
  const filteredY = filterY.filter(target.y, now);

  // Calculate Velocity Vector for Predictive Motion
  const dt = (now - lastTimestamp) / 1000;
  if (dt > 0 && dt < 0.1) {
    currentVelocity.vx = (filteredX - lastRawX) / dt;
    currentVelocity.vy = (filteredY - lastRawY) / dt;
  }
  lastRawX = filteredX;
  lastRawY = filteredY;
  lastTimestamp = now;

  const cursor: Point = { x: filteredX, y: filteredY };

  // Map full 21 3D landmarks for direct canvas skeleton rendering
  const landmarkPoints: LandmarkPoint[] = landmarks.map((l) => ({
    x: l.x,
    y: l.y,
    z: l.z ?? 0,
  }));

  return {
    detected: true,
    cursor,
    rawIndex,
    rawThumb,
    pinchDist,
    pinching,
    isPointing,
    twoFingers,
    threeFingers,
    openPalm,
    fist,
    activeGesture,
    fingerCount,
    thumbOut: thumbExt,
    landmarks: landmarkPoints,
  };
}