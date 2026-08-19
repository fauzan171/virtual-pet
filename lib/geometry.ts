import type { Point } from './types';
import { PEN_DEADZONE_PX } from './constants.ts';

/**
 * Pen deadzone: returns the next stroke point only when the cursor actually
 * travelled from the last committed point. Sub-deadzone movement (tracking
 * jitter) returns null and the pen tip stays put — no wiggle while held.
 * Deliberate slow moves still pass: distance accumulates from the anchor,
 * which only advances when a point is committed.
 */
export function applyPenDeadzone(next: Point, anchor: Point): Point | null {
  if (Math.hypot(next.x - anchor.x, next.y - anchor.y) < PEN_DEADZONE_PX) return null;
  return next;
}

/** Euclidean distance between two normalized landmarks. */
export function pinchDistance(a: Point, b: Point): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

/**
 * Pinch distance normalized by hand size (wrist → middle-finger MCP span).
 * Without this the raw distance varies with how far the hand is from the
 * camera, which flickers the pinch state mid-stroke. Normalized values are
 * comparable across presenters and positions.
 */
export function normalizedPinchDistance(thumbTip: Point, indexTip: Point, wrist: Point, middleMcp: Point): number {
  const span = Math.hypot(middleMcp.x - wrist.x, middleMcp.y - wrist.y);
  if (span < 1e-4) return 1; // degenerate hand — report as open
  return pinchDistance(thumbTip, indexTip) / span;
}
