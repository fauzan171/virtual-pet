'use client';

import { useEffect, useRef, useState } from 'react';
import type { LandmarkPoint } from '@/lib/types';

interface Props {
  stream: MediaStream | null;
  landmarksRef: React.RefObject<LandmarkPoint[] | undefined>;
}

const HAND_CONNECTIONS: [number, number][] = [
  // Thumb
  [0, 1], [1, 2], [2, 3], [3, 4],
  // Index
  [0, 5], [5, 6], [6, 7], [7, 8],
  // Middle
  [0, 9], [9, 10], [10, 11], [11, 12],
  // Ring
  [0, 13], [13, 14], [14, 15], [15, 16],
  // Pinky
  [0, 17], [17, 18], [18, 19], [19, 20],
  // Palm base
  [5, 9], [9, 13], [13, 17],
];

export default function CameraPreview({ stream, landmarksRef }: Props) {
  const localRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [showSkeleton, setShowSkeleton] = useState(true);
  const animRef = useRef<number>(0);

  useEffect(() => {
    if (localRef.current && stream) {
      localRef.current.srcObject = stream;
      localRef.current.play().catch(() => {});
    }
  }, [stream]);

  // High-performance direct Canvas rendering loop (0 React re-renders)
  useEffect(() => {
    const drawSkeleton = () => {
      const canvas = canvasRef.current;
      if (canvas) {
        const ctx = canvas.getContext('2d');
        if (ctx) {
          ctx.clearRect(0, 0, canvas.width, canvas.height);
          const landmarks = landmarksRef.current;

          if (showSkeleton && landmarks && landmarks.length >= 21) {
            const w = canvas.width;
            const h = canvas.height;

            // Draw Bones (Connections)
            ctx.lineWidth = 2.5;
            ctx.lineCap = 'round';
            ctx.strokeStyle = 'rgba(0, 240, 255, 0.75)';
            ctx.shadowBlur = 6;
            ctx.shadowColor = '#00f0ff';

            for (const [from, to] of HAND_CONNECTIONS) {
              const p1 = landmarks[from];
              const p2 = landmarks[to];
              if (!p1 || !p2) continue;

              const x1 = (1 - p1.x) * w;
              const y1 = p1.y * h;
              const x2 = (1 - p2.x) * w;
              const y2 = p2.y * h;

              ctx.beginPath();
              ctx.moveTo(x1, y1);
              ctx.lineTo(x2, y2);
              ctx.stroke();
            }

            // Draw Joint Nodes
            for (let i = 0; i < landmarks.length; i++) {
              const lm = landmarks[i];
              const x = (1 - lm.x) * w;
              const y = lm.y * h;
              const isTip = i === 4 || i === 8 || i === 12 || i === 16 || i === 20;

              ctx.beginPath();
              ctx.arc(x, y, isTip ? 4 : 2.5, 0, Math.PI * 2);
              ctx.fillStyle = isTip ? '#ffffff' : '#00f0ff';
              ctx.shadowBlur = isTip ? 10 : 4;
              ctx.shadowColor = isTip ? '#ffffff' : '#00f0ff';
              ctx.fill();
            }

            ctx.shadowBlur = 0;
          }
        }
      }
      animRef.current = requestAnimationFrame(drawSkeleton);
    };

    animRef.current = requestAnimationFrame(drawSkeleton);
    return () => cancelAnimationFrame(animRef.current);
  }, [landmarksRef, showSkeleton]);

  if (!stream) return null;

  return (
    <div className="absolute bottom-5 right-5 z-30 w-[360px] overflow-hidden rounded-2xl border border-cyan-400/30 bg-slate-950/80 shadow-[0_10px_40px_rgba(0,0,0,0.8),0_0_20px_rgba(0,240,255,0.2)] backdrop-blur-xl">
      <div className="relative aspect-[4/3] w-full overflow-hidden bg-black/40">
        <video
          ref={localRef}
          autoPlay
          playsInline
          muted
          className="h-full w-full object-cover -scale-x-100"
        />
        <canvas
          ref={canvasRef}
          width={360}
          height={270}
          className="pointer-events-none absolute inset-0 h-full w-full"
        />
      </div>

      <div className="flex items-center justify-between bg-slate-900/90 px-3.5 py-2 border-t border-white/10">
        <div className="flex items-center gap-2">
          <span className="h-2 w-2 animate-pulse rounded-full bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.8)]" />
          <span className="text-[11px] font-bold tracking-widest text-white/80">
            VISION LIVE
          </span>
        </div>
        <button
          onClick={() => setShowSkeleton((v) => !v)}
          className={`rounded-full px-2.5 py-0.5 text-[10px] font-extrabold tracking-wider transition ${
            showSkeleton
              ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-400/40 shadow-sm'
              : 'bg-white/5 text-white/40 border border-white/10 hover:text-white/70'
          }`}
        >
          {showSkeleton ? 'SKELETON ON' : 'SKELETON OFF'}
        </button>
      </div>
    </div>
  );
}