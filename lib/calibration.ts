import { PINCH_ON, PINCH_OFF, REGION } from './constants';
import type { Point } from './types';

/** Persisted per-presenter calibration, stored in localStorage. */
export interface CalibrationData {
  // Comfortable interaction region in normalized camera coords
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
  pinchOn: number;
  pinchOff: number;
}

const KEY = 'aircanvas:calibration';

export function loadCalibration(): CalibrationData | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as CalibrationData) : null;
  } catch {
    return null;
  }
}

export function saveCalibration(data: CalibrationData): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(data));
  } catch {
    // Storage unavailable — calibration just won't persist
  }
}

export function clearCalibration(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* noop */
  }
}

/** Defaults used when no calibration is saved. */
export function effectiveCalibration(): CalibrationData {
  const saved = loadCalibration();
  if (saved) return saved;
  const lo = (1 - REGION) / 2;
  return { minX: lo, maxX: 1 - lo, minY: lo, maxY: 1 - lo, pinchOn: PINCH_ON, pinchOff: PINCH_OFF };
}

/** Map normalized camera coords to canvas px using calibrated region + mirror. */
export function mapWithCalibration(
  nx: number,
  ny: number,
  cw: number,
  ch: number,
  cal: CalibrationData
): Point {
  const clamp = (v: number) => Math.min(1, Math.max(0, v));
  const tx = clamp((nx - cal.minX) / Math.max(cal.maxX - cal.minX, 1e-4));
  const ty = clamp((ny - cal.minY) / Math.max(cal.maxY - cal.minY, 1e-4));
  return { x: (1 - tx) * cw, y: ty * ch };
}

/**
 * Derive pinch thresholds from collected distances.
 * Ponytail: percentile heuristic, good enough for one-presenter stage use;
 * upgrade to per-frame state machine if multi-presenter support lands.
 */
export function computePinchThresholds(distances: number[]): { on: number; off: number } {
  const sorted = [...distances].sort((a, b) => a - b);
  const lo = sorted[Math.floor(sorted.length * 0.25)] ?? PINCH_ON;
  const hi = sorted[Math.floor(sorted.length * 0.75)] ?? PINCH_OFF;
  const mid = (lo + hi) / 2;
  return { on: mid - (hi - lo) * 0.15, off: mid + (hi - lo) * 0.15 };
}
