'use client';

import type { AppState, HandFrame } from '@/lib/types';

interface Props {
  fps: number;
  frame: HandFrame | null;
  state: AppState;
  strokeCount: number;
  latency: {
    avgDetectMs: number;
    maxDetectMs: number;
    avgLoopMs: number;
    maxLoopMs: number;
    avgFrameIntervalMs: number;
    maxFrameIntervalMs: number;
  };
}

export default function DebugPanel({ fps, frame, state, strokeCount, latency }: Props) {
  return (
    <div className="absolute bottom-4 left-4 z-40 rounded-lg bg-black/70 p-4 font-mono text-xs text-green-300 backdrop-blur">
      <div>FPS: {fps.toFixed(0)}</div>
      <div>CAM FRAME: {latency.avgFrameIntervalMs.toFixed(1)}ms avg / {latency.maxFrameIntervalMs.toFixed(1)}ms max</div>
      <div>MEDIAPIPE: {latency.avgDetectMs.toFixed(1)}ms avg / {latency.maxDetectMs.toFixed(1)}ms max</div>
      <div>LOOP: {latency.avgLoopMs.toFixed(1)}ms avg / {latency.maxLoopMs.toFixed(1)}ms max</div>
      <div>HAND: {frame?.detected ? 'yes' : 'no'}</div>
      <div>
        PINCH: {frame ? frame.pinchDist.toFixed(4) : '—'}{' '}
        {frame?.pinching ? '[PINCHING]' : ''}
      </div>
      <div>
        CURSOR: {frame ? `${frame.cursor.x.toFixed(0)}, ${frame.cursor.y.toFixed(0)}` : '—'}
      </div>
      <div>FINGERS: {frame ? frame.fingerCount : '—'}{frame?.thumbOut ? ' (thumb out)' : ''}</div>
      <div>STATE: {state}</div>
      <div>STROKES: {strokeCount}</div>
    </div>
  );
}
