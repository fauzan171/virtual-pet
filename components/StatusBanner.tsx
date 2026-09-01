'use client';

import type { AppState } from '@/lib/types';

const MESSAGES: Partial<Record<AppState, string>> = {
  INITIALIZING: 'LOADING HAND TRACKING…',
  CAMERA_PERMISSION: 'CAMERA ACCESS REQUIRED — ALLOW IN BROWSER',
  READY: 'SHOW YOUR HAND TO BEGIN',
  DRAWING: '● HAND TRACKING ACTIVE',
  CAPTURE: 'SKETCH CAPTURED ✓',
  GENERATING: 'CREATING WITH AI…',
};

export default function StatusBanner({
  state,
  custom,
}: {
  state: AppState;
  custom?: string | null;
}) {
  const message = custom ?? MESSAGES[state];
  if (!message) return null;
  return (
    <div className="pointer-events-none absolute top-8 left-1/2 z-30 -translate-x-1/2">
      <p role="status" aria-live="polite" className="rounded-full bg-black/40 px-8 py-3 text-xl font-semibold tracking-[0.2em] text-white/90 backdrop-blur">
        {message}
      </p>
    </div>
  );
}
