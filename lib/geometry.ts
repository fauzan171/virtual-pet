import type { Point } from './types';

/**
 * Adaptive smoothing + dead-zone gate. Small movements (hand tremor) are
 * ignored entirely; fast deliberate moves get a higher alpha so sweeps
 * stay responsive. Returns prev unchanged when inside the dead zone.
 */
export function smoothAdaptive(
  prev: Point,
  next: Point,
  alphaSlow: number,
  alphaFast: number,
  fastThreshold: number,
  deadZone: number
): Point {
  const dx = next.x - prev.x;
  const dy = next.y - prev.y;
  const dist = Math.hypot(dx, dy);
  if (dist < deadZone) return prev;
  const alpha = dist > fastThreshold ? alphaFast : alphaSlow;
  return { x: prev.x + alpha * dx, y: prev.y + alpha * dy };
}

/** Euclidean distance between two normalized landmarks. */
export function pinchDistance(a: Point, b: Point): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}
