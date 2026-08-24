import type { Point, ShapeId, DetectedShapeResult } from './types';
import { pointDistance, getBoundingBox, getPathLength } from './geometry';

/**
 * Recognizes if a hand-drawn stroke forms a geometric shape:
 * circle, square, rectangle, triangle, star, heart, or line/arrow.
 */
export function recognizeShape(points: Point[]): DetectedShapeResult | null {
  if (points.length < 8) return null;

  const totalLength = getPathLength(points);
  if (totalLength < 30) return null; // Too small to be a deliberate shape

  const bounds = getBoundingBox(points);
  const diag = Math.hypot(bounds.width, bounds.height);
  if (diag < 25) return null;

  const startPt = points[0];
  const endPt = points[points.length - 1];
  const closureDist = pointDistance(startPt, endPt);
  const isClosed = closureDist < Math.max(bounds.width, bounds.height) * 0.35 || closureDist < 50;

  // 1. Check for Straight Line
  const directDist = pointDistance(startPt, endPt);
  const straightness = directDist / Math.max(totalLength, 1e-4);
  if (straightness > 0.88 && !isClosed) {
    return {
      type: 'line',
      confidence: Math.min(1, straightness),
      label: 'Line',
      points: [startPt, endPt],
    };
  }

  // If not closed enough, check if it's an arrow or open curve
  if (!isClosed) {
    return null;
  }

  // 2. Center and Radii Analysis (for Circle / Ellipse)
  const cx = bounds.centerX;
  const cy = bounds.centerY;
  const radii: number[] = [];
  for (const p of points) {
    radii.push(Math.hypot(p.x - cx, p.y - cy));
  }
  const avgRadius = radii.reduce((a, b) => a + b, 0) / radii.length;
  const radialVariance =
    radii.reduce((acc, r) => acc + (r - avgRadius) ** 2, 0) / radii.length;
  const radialStdDev = Math.sqrt(radialVariance);
  const radialScore = 1 - radialStdDev / Math.max(avgRadius, 1);
  const aspectRatio = bounds.width / Math.max(bounds.height, 1);

  // 3. Find Sharp Corners (vertices)
  const corners = findCorners(points);

  // 4. Circle / Ellipse Detection
  if (radialScore > 0.76 && corners.length <= 2 && aspectRatio > 0.7 && aspectRatio < 1.4) {
    // Generate smooth circle points
    const circlePts: Point[] = [];
    const r = (bounds.width + bounds.height) / 4;
    for (let i = 0; i <= 32; i++) {
      const theta = (i / 32) * Math.PI * 2;
      circlePts.push({
        x: cx + r * Math.cos(theta),
        y: cy + r * Math.sin(theta),
      });
    }
    return {
      type: 'circle',
      confidence: Math.min(1, radialScore),
      label: 'Circle',
      points: circlePts,
    };
  }

  // 5. Triangle Detection (3 dominant corners)
  if (corners.length === 3) {
    const p1 = points[corners[0]];
    const p2 = points[corners[1]];
    const p3 = points[corners[2]];
    return {
      type: 'triangle',
      confidence: 0.85,
      label: 'Triangle',
      points: [p1, p2, p3, p1],
    };
  }

  // 6. Square / Rectangle Detection (4 dominant corners or boxy shape)
  if (corners.length === 4 || (corners.length >= 3 && corners.length <= 5 && radialScore < 0.7)) {
    const isSquare = aspectRatio >= 0.8 && aspectRatio <= 1.25;
    const padX = bounds.width * 0.05;
    const padY = bounds.height * 0.05;
    const x1 = bounds.minX + padX;
    const x2 = bounds.maxX - padX;
    const y1 = bounds.minY + padY;
    const y2 = bounds.maxY - padY;

    const rectPts: Point[] = [
      { x: x1, y: y1 },
      { x: x2, y: y1 },
      { x: x2, y: y2 },
      { x: x1, y: y2 },
      { x: x1, y: y1 },
    ];

    return {
      type: isSquare ? 'square' : 'rectangle',
      confidence: 0.82,
      label: isSquare ? 'Square' : 'Rectangle',
      points: rectPts,
    };
  }

  // 7. Star Detection (5 peaks or high corner count with alternating radius)
  if (corners.length >= 5 && corners.length <= 10) {
    const starPts: Point[] = [];
    const outerR = Math.max(bounds.width, bounds.height) / 2;
    const innerR = outerR * 0.45;
    for (let i = 0; i < 10; i++) {
      const r = i % 2 === 0 ? outerR : innerR;
      const angle = (i * Math.PI) / 5 - Math.PI / 2;
      starPts.push({
        x: cx + r * Math.cos(angle),
        y: cy + r * Math.sin(angle),
      });
    }
    starPts.push(starPts[0]);
    return {
      type: 'star',
      confidence: 0.8,
      label: 'Star',
      points: starPts,
    };
  }

  // 8. Heart Detection (Top dip with two arches and bottom point)
  if (checkHeartShape(points, bounds)) {
    const heartPts: Point[] = generateHeartPoints(cx, cy, bounds.width, bounds.height);
    return {
      type: 'heart',
      confidence: 0.84,
      label: 'Heart',
      points: heartPts,
    };
  }

  return null;
}

/** Finds indices of sharp corners in the point sequence. */
function findCorners(points: Point[]): number[] {
  const corners: number[] = [];
  const lookAhead = Math.max(3, Math.floor(points.length / 25));

  for (let i = lookAhead; i < points.length - lookAhead; i++) {
    const prev = points[i - lookAhead];
    const curr = points[i];
    const next = points[i + lookAhead];

    const v1 = { x: curr.x - prev.x, y: curr.y - prev.y };
    const v2 = { x: next.x - curr.x, y: next.y - curr.y };

    const l1 = Math.hypot(v1.x, v1.y);
    const l2 = Math.hypot(v2.x, v2.y);
    if (l1 < 1e-3 || l2 < 1e-3) continue;

    const dot = (v1.x * v2.x + v1.y * v2.y) / (l1 * l2);
    // Sharp angle has small or negative dot product
    if (dot < 0.45) {
      if (corners.length === 0 || i - corners[corners.length - 1] > lookAhead * 1.5) {
        corners.push(i);
      }
    }
  }

  return corners;
}

/** Heuristic check for heart shape. */
function checkHeartShape(
  points: Point[],
  bounds: { minX: number; maxX: number; minY: number; maxY: number; centerX: number; centerY: number; width: number; height: number }
): boolean {
  if (points.length < 15) return false;
  // Heart should have top midpoint lower than top extremes, and bottom point near centerX
  const topQuarterY = bounds.minY + bounds.height * 0.35;
  const bottomQuarterY = bounds.maxY - bounds.height * 0.25;

  let hasTopDip = false;
  let hasBottomPoint = false;

  for (const p of points) {
    if (Math.abs(p.x - bounds.centerX) < bounds.width * 0.2 && p.y > bounds.minY + bounds.height * 0.15 && p.y < topQuarterY) {
      hasTopDip = true;
    }
    if (Math.abs(p.x - bounds.centerX) < bounds.width * 0.25 && p.y > bottomQuarterY) {
      hasBottomPoint = true;
    }
  }

  return hasTopDip && hasBottomPoint;
}

/** Generate clean bezier/parametric heart points. */
function generateHeartPoints(cx: number, cy: number, w: number, h: number): Point[] {
  const pts: Point[] = [];
  const scale = Math.min(w, h) / 32;
  const adjustedCy = cy + h * 0.1;

  for (let t = 0; t <= Math.PI * 2; t += 0.15) {
    const x = 16 * Math.sin(t) ** 3;
    const y = -(13 * Math.cos(t) - 5 * Math.cos(2 * t) - 2 * Math.cos(3 * t) - Math.cos(4 * t));
    pts.push({
      x: cx + x * scale,
      y: adjustedCy + y * scale,
    });
  }
  if (pts.length > 0) pts.push(pts[0]);
  return pts;
}
