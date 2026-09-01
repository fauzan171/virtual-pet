'use client';

import { useEffect, useRef } from 'react';
import VoicePromptPanel from './VoicePromptPanel';
import type { VoiceCaptureStatus } from '@/lib/voice-prompt-recorder';

/**
 * Mirrored webcam pip. Receives the shared MediaStream as a prop — the same
 * stream feeds the hidden MediaPipe video, so no second getUserMedia call.
 */
export default function CameraPreview({
  stream,
  onRect,
  voiceStatus,
  voiceTranscript,
  voicePrompt,
}: {
  stream: MediaStream | null;
  onRect?(rect: DOMRect | null): void;
  voiceStatus: VoiceCaptureStatus | 'idle' | 'ready' | 'error';
  voiceTranscript: string;
  voicePrompt: string;
}) {
  const localRef = useRef<HTMLVideoElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (localRef.current && stream) {
      localRef.current.srcObject = stream;
      localRef.current.play().catch(() => {});
    }
  }, [stream]);

  useEffect(() => {
    const root = rootRef.current;
    if (!root || !onRect) return;
    const update = () => onRect(root.getBoundingClientRect());
    update();
    const observer = new ResizeObserver(update);
    observer.observe(root);
    window.addEventListener('resize', update);
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', update);
      onRect(null);
    };
  }, [onRect, stream]);

  if (!stream) return null;

  return (
    <div ref={rootRef} className="relative z-30 flex w-[320px] shrink-0 flex-col justify-end gap-3 px-5 pb-6">
      <VoicePromptPanel status={voiceStatus} transcript={voiceTranscript} prompt={voicePrompt} />
      <div className="overflow-hidden rounded-xl border border-white/20 bg-black shadow-lg">
        {/* Mirrored so presenter sees themselves like a mirror */}
        <video ref={localRef} autoPlay playsInline muted className="aspect-[4/3] w-full -scale-x-100 object-cover" />
        <div className="flex items-center justify-between bg-black/80 px-3 py-1.5 font-mono">
          <div className="flex items-center gap-1.5">
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-red-500" />
            <span className="text-[9px] font-bold tracking-[0.2em] text-white/55">PRESENTER CAMERA</span>
          </div>
          <span className="text-[8px] tracking-[0.18em] text-cyan-200/45">LIVE TRACKING</span>
        </div>
      </div>
    </div>
  );
}
