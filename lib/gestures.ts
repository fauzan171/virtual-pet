import type { HandFrame } from './types';
import { GESTURE_HOLD_MS } from './constants.ts';

/**
 * Convert MediaPipe's finger metadata into the gesture command used by the UI.
 * The thumb is excluded from the 2–4 finger tool gestures because it is also
 * the pinch finger. A true five-finger open palm is reserved for the command
 * wheel, so it must be recognized before the thumb is removed from the count.
 */
export function commandFingerCount(
  frame: Pick<HandFrame, 'fingerCount' | 'thumbOut' | 'twoFingers'>
): number {
  if (frame.fingerCount === 5 && frame.thumbOut) return 5;
  const raised = frame.fingerCount - (frame.thumbOut ? 1 : 0);
  if (raised === 2) return frame.twoFingers ? 2 : 0;
  return raised === 3 || raised === 4 ? raised : 0;
}

/** FPS-independent gesture hold detector. Fires once until the pose changes. */
export class GestureHoldDetector {
  private count = 0;
  private since = 0;
  private fired = false;

  update(count: number, timestampMs: number): number | null {
    if (count < 2 || count > 5) {
      this.reset();
      return null;
    }
    if (count !== this.count) {
      this.count = count;
      this.since = timestampMs;
      this.fired = false;
      return null;
    }
    if (!this.fired && timestampMs - this.since >= GESTURE_HOLD_MS) {
      this.fired = true;
      return count;
    }
    return null;
  }

  reset(): void {
    this.count = 0;
    this.since = 0;
    this.fired = false;
  }
}
