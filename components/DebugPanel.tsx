'use client';

import type { AppState, HandFrame } from '@/lib/types';

interface Props {
  fps: number;
  frame: HandFrame | null;
  state: AppState;
  strokeCount: number;
}

export default function DebugPanel({ fps, frame, state, strokeCount }: Props) {
  return (
    <div className="absolute bottom-4 left-4 z-40 rounded-lg bg-black/70 p-4 font-mono text-xs text-green-300 backdrop-blur">
      <div>FPS: {fps.toFixed(0)}</div>
      <div>HAND: {frame?.detected ? 'yes' : 'no'}</div>
      <div>
        PINCH: {frame ? frame.pinchDist.toFixed(4) : '—'}{' '}
        {frame?.pinching ? '[PINCHING]' : ''}
      </div>
      <div>
        CURSOR: {frame ? `${frame.cursor.x.toFixed(0)}, ${frame.cursor.y.toFixed(0)}` : '—'}
      </div>
      <div>STATE: {state}</div>
      <div>STROKES: {strokeCount}</div>
    </div>
  );
}
