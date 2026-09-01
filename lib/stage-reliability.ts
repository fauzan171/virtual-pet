import { MAX_REACQUIRE_JUMP_PX } from './constants.ts';
import type { Point, Stroke } from './types.ts';

export function shouldSplitReacquiredStroke(
  lostFrames: number,
  previous: Point,
  current: Point,
  maxJumpPx = MAX_REACQUIRE_JUMP_PX
): boolean {
  return lostFrames > 0 && Math.hypot(current.x - previous.x, current.y - previous.y) > maxJumpPx;
}

export function scaleStrokeInPlace(stroke: Stroke, scaleX: number, scaleY: number): void {
  for (const point of stroke.points) {
    point.x *= scaleX;
    point.y *= scaleY;
  }
  stroke.width *= Math.sqrt(scaleX * scaleY);
}

export function isAllowedGeneratedImageUrl(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  if (/^data:image\/(?:png|jpeg|webp);base64,/.test(value)) return value.length <= 15 * 1024 * 1024;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && url.hostname.endsWith('.aliyuncs.com');
  } catch {
    return false;
  }
}
