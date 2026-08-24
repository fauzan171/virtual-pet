'use client';

import { motion, AnimatePresence } from 'framer-motion';

export type CalibrationPhase = 'RANGE' | 'PINCH';

interface Props {
  phase: CalibrationPhase;
  /** 0-1 progress of the current phase */
  progress: number;
  onCancel(): void;
}

export default function CalibrationOverlay({ phase, progress, onCancel }: Props) {
  const percentage = Math.min(100, Math.max(0, Math.round(progress * 100)));

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="absolute inset-0 z-50 flex flex-col items-center justify-center bg-[#050510]/90 backdrop-blur-2xl p-6"
      >
        {/* Ambient Background Glow */}
        <div className="pointer-events-none absolute h-[500px] w-[500px] rounded-full bg-cyan-500/10 blur-[120px]" />

        {/* Header Badge */}
        <motion.div
          initial={{ y: -20, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          className="mb-8 flex items-center gap-2.5 rounded-full bg-cyan-950/80 px-6 py-2 border border-cyan-400/40 text-cyan-300 shadow-[0_0_20px_rgba(0,240,255,0.25)]"
        >
          <span className="h-2 w-2 animate-pulse rounded-full bg-cyan-400 shadow-[0_0_8px_#00f0ff]" />
          <span className="text-xs font-black tracking-[0.3em] uppercase">
            SYSTEM CALIBRATION
          </span>
        </motion.div>

        {/* Dynamic Content Switching Area */}
        <div className="relative min-h-[260px] w-full max-w-xl flex flex-col items-center justify-center">
          <AnimatePresence mode="wait">
            {phase === 'RANGE' ? (
              <motion.div
                key="phase-range"
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 1.05 }}
                transition={{ duration: 0.25 }}
                className="flex flex-col items-center gap-6 text-center"
              >
                <h2 className="text-3xl font-black text-white tracking-wider">
                  SWEEP YOUR HAND
                </h2>
                <p className="max-w-md text-sm text-slate-300 leading-relaxed font-medium">
                  Slowly move your hand across all 4 corners of the screen to calibrate spatial tracking bounds.
                </p>

                {/* Interactive Reticle Scan Graphic */}
                <div className="relative h-36 w-64 rounded-2xl border-2 border-dashed border-cyan-400/40 bg-slate-900/40 flex items-center justify-center shadow-[inset_0_0_30px_rgba(0,240,255,0.05)] overflow-hidden">
                  {/* Laser Sweep Line */}
                  <motion.div
                    className="absolute inset-x-0 h-0.5 bg-gradient-to-r from-transparent via-cyan-400 to-transparent shadow-[0_0_12px_#00f0ff]"
                    animate={{ top: ['10%', '90%', '10%'] }}
                    transition={{ repeat: Infinity, duration: 2.2, ease: 'easeInOut' }}
                  />
                  {/* Reticle Corner Marks */}
                  <span className="absolute left-2.5 top-2 text-cyan-400 text-xs font-mono">┌</span>
                  <span className="absolute right-2.5 top-2 text-cyan-400 text-xs font-mono">┐</span>
                  <span className="absolute left-2.5 bottom-2 text-cyan-400 text-xs font-mono">└</span>
                  <span className="absolute right-2.5 bottom-2 text-cyan-400 text-xs font-mono">┘</span>
                  <span className="text-[11px] font-black tracking-widest text-cyan-300/80 uppercase">
                    CANVAS BOUNDS
                  </span>
                </div>
              </motion.div>
            ) : (
              <motion.div
                key="phase-pinch"
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 1.05 }}
                transition={{ duration: 0.25 }}
                className="flex flex-col items-center gap-6 text-center"
              >
                <h2 className="text-3xl font-black text-white tracking-wider">
                  SAMPLE PINCH SENSITIVITY
                </h2>
                <p className="max-w-md text-sm text-slate-300 leading-relaxed font-medium">
                  Pinch your thumb and index finger together, then release. Repeat until threshold is captured.
                </p>

                {/* Animated Pinch Pulse Icon */}
                <motion.div
                  className="relative flex h-28 w-28 items-center justify-center rounded-3xl bg-amber-500/10 border border-amber-400/40 text-5xl shadow-[0_0_30px_rgba(251,191,36,0.2)]"
                  animate={{ scale: [1, 0.9, 1] }}
                  transition={{ repeat: Infinity, duration: 1.2, ease: 'easeInOut' }}
                >
                  <span className="select-none">🤏</span>
                </motion.div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {/* Progress Tracker Bar */}
        <div className="mt-8 w-80 flex flex-col gap-2">
          <div className="flex items-center justify-between text-xs font-black tracking-widest">
            <span className="text-cyan-400 uppercase">
              {phase === 'RANGE' ? 'STEP 1: RANGE SAMPLING' : 'STEP 2: PINCH THRESHOLD'}
            </span>
            <span className="text-white font-mono">{percentage}%</span>
          </div>

          {/* Track Bar */}
          <div className="h-3 w-full overflow-hidden rounded-full bg-white/10 p-0.5 border border-white/15">
            <motion.div
              className="h-full rounded-full bg-gradient-to-r from-cyan-500 via-cyan-400 to-amber-300 shadow-[0_0_12px_rgba(0,240,255,0.6)]"
              initial={{ width: '0%' }}
              animate={{ width: `${percentage}%` }}
              transition={{ type: 'spring', stiffness: 300, damping: 30 }}
            />
          </div>
        </div>

        {/* Cancel Button */}
        <motion.button
          whileHover={{ scale: 1.05 }}
          whileTap={{ scale: 0.95 }}
          onClick={onCancel}
          className="mt-10 flex items-center gap-2.5 rounded-2xl bg-white/5 hover:bg-white/10 px-8 py-3 text-xs font-black tracking-widest text-slate-300 border border-white/15 transition shadow-lg active:scale-95"
        >
          <span>CANCEL CALIBRATION</span>
          <kbd className="rounded bg-white/10 px-2 py-0.5 text-[10px] font-mono text-cyan-300 border border-white/10">
            B
          </kbd>
        </motion.button>
      </motion.div>
    </AnimatePresence>
  );
}