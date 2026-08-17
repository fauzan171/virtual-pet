'use client';

import { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';

const STAGES = [
  'CAPTURING YOUR IDEA',
  'UNDERSTANDING YOUR SKETCH',
  'CREATING WITH AI',
  'BRINGING YOUR IDEA TO LIFE',
] as const;

// Time to dwell on each stage (ms) — advances only while awaiting generation.
const STAGE_MS = [900, 1600, 2600, 3200];

/**
 * Staged progress animation shown during CAPTURE + GENERATING.
 * No fake percentages — just rotating stage messages with a subtle pulse.
 */
export default function LoadingExperience() {
  const [stage, setStage] = useState(0);

  useEffect(() => {
    let i = 0;
    let timer: ReturnType<typeof setTimeout>;
    const advance = () => {
      i = Math.min(i + 1, STAGES.length - 1);
      setStage(i);
      if (i < STAGES.length - 1) timer = setTimeout(advance, STAGE_MS[i]);
    };
    timer = setTimeout(advance, STAGE_MS[0]);
    return () => clearTimeout(timer);
  }, []);

  return (
    <div className="absolute inset-0 z-30 flex flex-col items-center justify-center gap-8 bg-[#050510]/90 backdrop-blur-sm">
      <motion.div
        className="h-16 w-16 rounded-full border-2 border-cyan-300/40 border-t-cyan-300"
        animate={{ rotate: 360 }}
        transition={{ duration: 1.2, repeat: Infinity, ease: 'linear' }}
      />
      <AnimatePresence mode="wait">
        <motion.p
          key={stage}
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -12 }}
          transition={{ duration: 0.3 }}
          className="text-3xl font-semibold tracking-[0.25em] text-white"
        >
          {STAGES[stage]}
        </motion.p>
      </AnimatePresence>
      <div className="flex gap-2">
        {STAGES.map((_, i) => (
          <div
            key={i}
            className={`h-1.5 w-10 rounded-full transition-colors duration-500 ${
              i <= stage ? 'bg-cyan-300' : 'bg-white/10'
            }`}
          />
        ))}
      </div>
    </div>
  );
}
