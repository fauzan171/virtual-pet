import type { Point } from './types';
import { PEN_DEADZONE_PX } from './constants.ts';

export interface Landmark3D {
  x: number;
  y: number;
  z?: number;
}

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

/** Euclidean distance between two 2D/3D points. */
export function pointDistance(a: Landmark3D | Point, b: Landmark3D | Point): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

/** Legacy alias for backward compatibility. */
export function pinchDistance(a: Point, b: Point): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

/**
 * Pinch distance normalized by hand size (wrist → middle-finger MCP span).
 * Without this the raw distance varies with how far the hand is from the
 * camera, which flickers the pinch state mid-stroke. Normalized values are
 * comparable across presenters and positions.
 */
export function normalizedPinchDistance(
  thumbTip: Landmark3D | Point,
  indexTip: Landmark3D | Point,
  wrist: Landmark3D | Point,
  middleMcp: Landmark3D | Point
): number {
  const span = pointDistance(middleMcp, wrist);
  if (span < 1e-4) return 1; // degenerate hand — report as open
  return pointDistance(thumbTip, indexTip) / span;
}

/** 3D Euclidean distance between two landmarks. */
export function pointDistance3D(a: Landmark3D | Point, b: Landmark3D | Point): number {
  const az = (a as Landmark3D).z ?? 0;
  const bz = (b as Landmark3D).z ?? 0;
  return Math.hypot(a.x - b.x, a.y - b.y, az - bz);
}

/**
 * Evaluates whether a finger (Index, Middle, Ring, Pinky) is extended
 * using 3D bone straightness ratios and wrist distance comparisons.
 * Highly robust to hand orientation, camera tilt, and finger proportions.
 */
export function isFingerExtended(
  lm: (Landmark3D | Point)[],
  mcp: number,
  pip: number,
  dip: number,
  tip: number,
  wrist: number = 0
): boolean {
  if (!lm[tip] || !lm[pip] || !lm[mcp] || !lm[wrist]) return false;

  // Direct distance from MCP to Tip
  const directMcpToTip = pointDistance3D(lm[mcp], lm[tip]);

  // Sum of individual bone segment lengths (MCP->PIP, PIP->DIP, DIP->TIP)
  const dMcpPip = pointDistance3D(lm[mcp], lm[pip]);
  const dPipDip = lm[dip] ? pointDistance3D(lm[pip], lm[dip]) : dMcpPip * 0.75;
  const dDipTip = lm[dip] ? pointDistance3D(lm[dip], lm[tip]) : dMcpPip * 0.55;
  const totalSegmentLength = dMcpPip + dPipDip + dDipTip;

  // Straightness ratio: ~0.85-1.0 for extended finger, <0.60 for curled/fist
  const straightness = directMcpToTip / Math.max(totalSegmentLength, 1e-4);

  const tipToWrist = pointDistance3D(lm[tip], lm[wrist]);
  const pipToWrist = pointDistance3D(lm[pip], lm[wrist]);
  const mcpToWrist = pointDistance3D(lm[mcp], lm[wrist]);

  // Extended finger criteria
  const isStraight = straightness > 0.68;
  const isExtendedFromPalm = tipToWrist > pipToWrist * 1.02 || tipToWrist > mcpToWrist * 1.15;

  return isStraight && isExtendedFromPalm;
}

/**
 * Evaluates whether thumb is extended open vs tucked/folded against the palm/fist.
 */
export function isThumbExtended(
  lm: (Landmark3D | Point)[],
  thumbTip: number = 4,
  thumbMcp: number = 2,
  pinkyMcp: number = 17,
  wrist: number = 0,
  thumbIp: number = 3,
  indexMcp: number = 5,
  middleMcp: number = 9
): boolean {
  if (!lm[thumbTip] || !lm[pinkyMcp] || !lm[wrist] || !lm[thumbMcp]) return false;

  const tipToPinky = pointDistance3D(lm[thumbTip], lm[pinkyMcp]);
  const wristToPinky = pointDistance3D(lm[wrist], lm[pinkyMcp]);
  const tipToIndexMcp = lm[indexMcp] ? pointDistance3D(lm[thumbTip], lm[indexMcp]) : 1;
  const handSpan = lm[middleMcp] ? pointDistance3D(lm[wrist], lm[middleMcp]) : wristToPinky;

  // Thumb straightness
  const directMcpToTip = pointDistance3D(lm[thumbMcp], lm[thumbTip]);
  const dMcpIp = lm[thumbIp] ? pointDistance3D(lm[thumbMcp], lm[thumbIp]) : directMcpToTip * 0.5;
  const dIpTip = lm[thumbIp] ? pointDistance3D(lm[thumbIp], lm[thumbTip]) : directMcpToTip * 0.5;
  const thumbStraightness = directMcpToTip / Math.max(dMcpIp + dIpTip, 1e-4);

  // Extended thumb is straight AND opened away from the index finger & palm base
  return (
    thumbStraightness > 0.72 &&
    tipToPinky > wristToPinky * 0.82 &&
    tipToIndexMcp > handSpan * 0.42
  );
}


/** Compute bounding box of a collection of points. */
export function getBoundingBox(pts: Point[]) {
  if (pts.length === 0) {
    return { minX: 0, maxX: 0, minY: 0, maxY: 0, centerX: 0, centerY: 0, width: 0, height: 0 };
  }
  let minX = pts[0].x;
  let maxX = pts[0].x;
  let minY = pts[0].y;
  let maxY = pts[0].y;

  for (let i = 1; i < pts.length; i++) {
    const p = pts[i];
    if (p.x < minX) minX = p.x;
    if (p.x > maxX) maxX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.y > maxY) maxY = p.y;
  }

  const width = Math.max(maxX - minX, 1);
  const height = Math.max(maxY - minY, 1);
  return {
    minX,
    maxX,
    minY,
    maxY,
    centerX: (minX + maxX) / 2,
    centerY: (minY + maxY) / 2,
    width,
    height,
  };
}

/** Compute total path length of a stroke. */
export function getPathLength(pts: Point[]): number {
  let len = 0;
  for (let i = 1; i < pts.length; i++) {
    len += pointDistance(pts[i], pts[i - 1]);
  }
  return len;
}

