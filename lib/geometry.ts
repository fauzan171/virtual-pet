import type { Point } from './types';
import { REGION, SMOOTHING } from './constants';

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}

/**
 * Map normalized camera coords [0,1] to canvas pixels.
 * Crops to the center REGION of the frame and mirrors X so the
 * presenter moving their hand right moves the cursor right.
 */
export function mapToCanvas(
  nx: number,
  ny: number,
  cw: number,
  ch: number
): Point {
  const lo = (1 - REGION) / 2;
  const tx = clamp((nx - lo) / REGION, 0, 1);
  const ty = clamp((ny - lo) / REGION, 0, 1);
  // Mirror X: camera is flipped for the presenter
  return { x: (1 - tx) * cw, y: ty * ch };
}

/** Exponential smoothing — cursor moves alpha toward target each frame. */
export function smooth(prev: Point, next: Point, alpha: number = SMOOTHING): Point {
  return {
    x: prev.x + alpha * (next.x - prev.x),
    y: prev.y + alpha * (next.y - prev.y),
  };
}

/** Euclidean distance between two normalized landmarks. */
export function pinchDistance(a: Point, b: Point): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}
