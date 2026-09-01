import type { VoiceCaptureStatus } from '@/lib/voice-prompt-recorder';

type Status = VoiceCaptureStatus | 'idle' | 'ready' | 'error';

interface Props {
  status: Status;
  transcript: string;
  prompt: string;
}

const STATUS_LABEL: Record<Status, string> = {
  idle: 'WAITING',
  listening: 'LISTENING',
  processing: 'AI CHECKING',
  ready: 'AI CHECKED',
  error: 'RETRY NEEDED',
};

export default function VoicePromptPanel({ status, transcript, prompt }: Props) {
  const active = status === 'listening' || status === 'processing';
  const ready = status === 'ready' && Boolean(prompt);

  return (
    <aside className="relative w-full overflow-hidden rounded-xl border border-cyan-200/20 bg-[#06101a]/95 font-mono shadow-[0_24px_70px_rgba(0,0,0,.48),inset_0_0_35px_rgba(34,211,238,.035)]">
      <div className="absolute inset-0 opacity-25 [background-image:linear-gradient(rgba(103,232,249,.08)_1px,transparent_1px)] [background-size:100%_22px]" />
      <div className="relative p-4">
        <div className="flex items-center justify-between border-b border-white/10 pb-3">
          <div>
            <p className="text-[8px] tracking-[0.34em] text-cyan-200/45">VOICE → IMAGE</p>
            <h2 className="mt-1 text-[13px] font-black tracking-[0.2em] text-white">PROMPT MONITOR</h2>
          </div>
          <div className={`flex items-center gap-2 rounded-full border px-2.5 py-1 text-[8px] font-black tracking-[0.16em] ${
            ready
              ? 'border-emerald-300/30 bg-emerald-300/10 text-emerald-200'
              : status === 'error'
                ? 'border-red-300/35 bg-red-300/10 text-red-200'
                : 'border-cyan-200/20 bg-cyan-200/[0.06] text-cyan-100'
          }`}>
            <span className={`h-1.5 w-1.5 rounded-full ${active ? 'animate-pulse bg-amber-300' : ready ? 'bg-emerald-300' : status === 'error' ? 'bg-red-400' : 'bg-cyan-300/55'}`} />
            {STATUS_LABEL[status]}
          </div>
        </div>

        {status === 'listening' ? (
          <div className="py-7 text-center">
            <div className="mx-auto flex h-8 items-center justify-center gap-1">
              {[12, 24, 17, 30, 20, 26, 14, 22, 10].map((height, index) => (
                <span
                  key={`${height}-${index}`}
                  className="w-1 animate-pulse rounded-full bg-amber-300/80"
                  style={{ height, animationDelay: `${index * 70}ms` }}
                />
              ))}
            </div>
            <p className="mt-4 text-xs font-black tracking-[0.22em] text-white">SPEAK YOUR IDEA</p>
            <p className="mt-1 text-[9px] tracking-[0.12em] text-white/40">PAUSE WHEN FINISHED · M TO CANCEL</p>
          </div>
        ) : status === 'processing' ? (
          <div className="py-7 text-center">
            <div className="mx-auto h-8 w-8 animate-spin rounded-full border-2 border-cyan-200/20 border-t-cyan-300" />
            <p className="mt-4 text-xs font-black tracking-[0.2em] text-cyan-100">VERIFYING SPEECH</p>
            <p className="mt-1 text-[9px] tracking-[0.12em] text-white/40">L1 ASR → L2 CORRECTION → L3 SAFETY</p>
          </div>
        ) : ready ? (
          <div className="space-y-3 pt-3">
            <div className="rounded-lg border border-white/[0.07] bg-black/25 px-3 py-2.5">
              <p className="text-[8px] tracking-[0.25em] text-white/35">HEARD</p>
              <p className="mt-1 line-clamp-2 text-[10px] leading-relaxed text-white/55">{transcript}</p>
            </div>
            <div className="rounded-lg border border-emerald-300/20 bg-emerald-300/[0.07] px-3 py-2.5 shadow-[0_0_24px_rgba(110,231,183,.05)]">
              <div className="flex items-center justify-between">
                <p className="text-[8px] tracking-[0.25em] text-emerald-200/70">AGENT-CORRECTED PROMPT</p>
                <span className="text-[9px] text-emerald-300">✓ 3 LAYERS PASSED</span>
              </div>
              <p className="mt-1 line-clamp-3 text-[11px] font-bold leading-relaxed text-white">{prompt}</p>
            </div>
            <p className="text-center text-[8px] tracking-[0.12em] text-white/30">M TO REPLACE · GENERATE TO CONFIRM</p>
          </div>
        ) : (
          <div className="py-7 text-center">
            <div className={`mx-auto flex h-10 w-10 items-center justify-center rounded-full border text-lg ${status === 'error' ? 'border-red-300/30 bg-red-300/10 text-red-200' : 'border-cyan-200/20 bg-cyan-200/[0.06] text-cyan-200'}`}>
              {status === 'error' ? '!' : 'M'}
            </div>
            <p className="mt-3 text-xs font-black tracking-[0.2em] text-white">
              {status === 'error' ? 'VOICE NOT CLEAR' : 'PRESS M TO SPEAK'}
            </p>
            <p className="mt-1 text-[9px] tracking-[0.1em] text-white/35">
              {status === 'error' ? 'TRY AGAIN · PROMPT NOT USED' : 'PROMPT REQUIRED BEFORE GENERATE'}
            </p>
          </div>
        )}
      </div>
    </aside>
  );
}
