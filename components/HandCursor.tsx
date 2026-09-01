'use client';

import { motion, type MotionValue } from 'framer-motion';

export type CursorState = 'normal' | 'pinch' | 'hover' | 'click';

interface Props {
  x: MotionValue<number>;
  y: MotionValue<number>;
  state: CursorState;
  /** Inner dot tint = current ink color, so the presenter sees what they'll draw with. */
  color?: string;
  /** 0..1 dwell-to-select progress — fills a ring around the cursor. */
  dwellProgress?: number;
}

const RING_SCALE: Record<CursorState, number> = {
  normal: 1,
  pinch: 0.6,
  hover: 1.5,
  click: 0.4,
};

export default function HandCursor({ x, y, state, color, dwellProgress = 0 }: Props) {
  return (
    <motion.div
      className="pointer-events-none fixed left-0 top-0 z-50"
      style={{ x, y }}
    >
      {/* Outer ring */}
      <motion.div
        className="absolute -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-cyan-300/80"
        initial={false}
        animate={{ scale: RING_SCALE[state], width: 36, height: 36 }}
        transition={{ duration: 0.12 }}
        style={{ boxShadow: '0 0 12px rgba(103,232,249,0.5)' }}
      />
      {/* Dwell progress ring — conic fill as dwell-to-select charges */}
      {dwellProgress > 0 && (
        <div
          className="absolute -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-amber-300"
          style={{
            width: 48,
            height: 48,
            backgroundImage:
              'conic-gradient(rgba(252,211,77,0.95) ' +
              dwellProgress * 360 +
              'deg, rgba(252,211,77,0.15) 0deg)',
            WebkitMask: 'radial-gradient(farthest-side, transparent calc(100% - 3px), #000 calc(100% - 2px))',
            mask: 'radial-gradient(farthest-side, transparent calc(100% - 3px), #000 calc(100% - 2px))',
          }}
        />
      )}
      {/* Inner dot — tinted with the selected ink color */}
      <motion.div
        className="absolute -translate-x-1/2 -translate-y-1/2 rounded-full border border-white/80"
        style={{ backgroundColor: color ?? '#67e8f9' }}
        initial={false}
        animate={{ scale: state === 'pinch' ? 1.6 : 1, width: 10, height: 10 }}
        transition={{ duration: 0.1 }}
      />
      {/* Click ripple */}
      {state === 'click' && (
        <motion.div
          className="absolute -translate-x-1/2 -translate-y-1/2 rounded-full border border-cyan-200"
          initial={{ scale: 0.5, opacity: 1, width: 40, height: 40 }}
          animate={{ scale: 2.5, opacity: 0 }}
          transition={{ duration: 0.4 }}
        />
      )}
    </motion.div>
  );
}
