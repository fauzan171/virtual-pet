'use client';

import { useEffect, useRef } from 'react';

/**
 * Mirrored webcam pip. Receives the shared MediaStream as a prop — the same
 * stream feeds the hidden MediaPipe video, so no second getUserMedia call.
 */
export default function CameraPreview({ stream }: { stream: MediaStream | null }) {
  const localRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    if (localRef.current && stream) {
      localRef.current.srcObject = stream;
      localRef.current.play().catch(() => {});
    }
  }, [stream]);

  if (!stream) return null;

  return (
    <div className="absolute bottom-4 right-4 z-30 w-[220px] overflow-hidden rounded-xl border border-white/20 shadow-lg">
      {/* Mirrored so presenter sees themselves like a mirror */}
      <video ref={localRef} autoPlay playsInline muted className="w-full -scale-x-100" />
      <div className="flex items-center gap-1.5 bg-black/70 px-2 py-1">
        <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-red-500" />
        <span className="text-[10px] font-medium tracking-widest text-white/60">CAMERA</span>
      </div>
    </div>
  );
}
