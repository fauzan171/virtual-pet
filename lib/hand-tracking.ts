import {
  FilesetResolver,
  HandLandmarker,
  type HandLandmarkerResult,
} from '@mediapipe/tasks-vision';
import { MODEL_URL, WASM_BASE, INDEX_TIP, THUMB_TIP, PINCH_ON, PINCH_OFF } from './constants';
import { mapToCanvas, smooth, pinchDistance } from './geometry';
import type { HandFrame, Point } from './types';

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
 * applies region mapping, mirror, smoothing, and pinch hysteresis.
 */
export function extractHandFrame(
  result: HandLandmarkerResult,
  canvasW: number,
  canvasH: number,
  prev: HandFrame | null
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
    };
  }

  const rawIndex: Point = { x: landmarks[INDEX_TIP].x, y: landmarks[INDEX_TIP].y };
  const rawThumb: Point = { x: landmarks[THUMB_TIP].x, y: landmarks[THUMB_TIP].y };
  const dist = pinchDistance(rawIndex, rawThumb);

  // Hysteresis: different thresholds for activation vs release
  const pinching = prev?.pinching ? dist < PINCH_OFF : dist < PINCH_ON;

  const target = mapToCanvas(rawIndex.x, rawIndex.y, canvasW, canvasH);
  const cursor = prev ? smooth(prev.cursor, target) : target;

  return { detected: true, cursor, rawIndex, rawThumb, pinchDist: dist, pinching };
}
