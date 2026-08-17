'use client';

import { useEffect, useRef, type RefObject } from 'react';

/**
 * Small mirrored webcam pip. Receives the same MediaStream as the hidden
 * MediaPipe video element via a ref to it — no duplicate getUserMedia call.
 */
export default function CameraPreview({
  videoRef,
}: {
  videoRef: RefObject<HTMLVideoElement | null>;
}) {
  const localRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    const stream = videoRef.current?.srcObject as MediaStream | null;
    if (localRef.current && stream) {
      localRef.current.srcObject = stream;
      localRef.current.play().catch(() => {});
    }
  }, [videoRef]);

  return (
    <div className="absolute bottom-4 right-4 z-30 w-[200px] overflow-hidden rounded-xl border border-white/20 shadow-lg">
      {/* Mirrored so presenter movement matches intuition */}
      <video
        ref={localRef}
        autoPlay
        playsInline
        muted
        className="w-full -scale-x-100"
      />
      <div className="flex items-center gap-1.5 bg-black/70 px-2 py-1">
        <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-red-500" />
        <span className="text-[10px] font-medium tracking-widest text-white/60">CAMERA</span>
      </div>
    </div>
  );
}
