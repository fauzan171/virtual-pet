'use client';

export type CalibrationPhase = 'RANGE' | 'PINCH';

interface Props {
  phase: CalibrationPhase;
  /** 0-1 progress of the current phase */
  progress: number;
  onCancel(): void;
}

/**
 * Full-screen calibration guide shown before the performance.
 * RANGE: presenter sweeps their hand across the interaction area.
 * PINCH: presenter pinches and releases repeatedly to sample distances.
 */
export default function CalibrationOverlay({ phase, progress, onCancel }: Props) {
  return (
    <div className="absolute inset-0 z-40 flex flex-col items-center justify-center gap-10 bg-[#050510]/95 backdrop-blur">
      <h2 className="text-4xl font-bold tracking-[0.25em] text-white">CALIBRATION</h2>

      {phase === 'RANGE' ? (
        <div className="flex flex-col items-center gap-6 text-center">
          <p className="max-w-2xl text-2xl leading-relaxed text-slate-200">
            Move your hand slowly so the cursor visits every corner of the white canvas.
          </p>
          <div className="relative h-40 w-64 rounded-xl border-2 border-dashed border-cyan-300/40">
            <div className="absolute inset-2 rounded-lg border border-cyan-300/20" />
          </div>
        </div>
      ) : (
        <div className="flex flex-col items-center gap-6 text-center">
          <p className="max-w-2xl text-2xl leading-relaxed text-slate-200">
            Pinch your thumb and index finger together, then release repeatedly for 6 seconds.
          </p>
          <div className="text-6xl">🤏</div>
        </div>
      )}

      <div className="w-80">
        <div className="mb-2 text-sm tracking-widest text-cyan-300">
          {phase === 'RANGE' ? 'STEP 1 — HAND RANGE' : 'STEP 2 — PINCH THRESHOLD'}
        </div>
        <div className="h-2 w-full overflow-hidden rounded-full bg-white/10">
          <div
            className="h-full rounded-full bg-cyan-300 transition-[width] duration-300"
            style={{ width: `${Math.round(progress * 100)}%` }}
          />
        </div>
      </div>

      <button
        onClick={onCancel}
        className="rounded-xl bg-white/5 px-8 py-3 text-lg tracking-widest text-slate-400 ring-1 ring-white/10 transition hover:bg-white/10"
      >
        CANCEL (B)
      </button>
    </div>
  );
}
