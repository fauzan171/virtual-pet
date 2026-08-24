'use client';

import { motion, type MotionValue } from 'framer-motion';

export type CursorState = 'normal' | 'pinch' | 'point' | 'hover' | 'click' | 'neutral';

interface Props {
  x: MotionValue<number>;
  y: MotionValue<number>;
  state: CursorState;
  /** Inner dot tint = current ink color, so the presenter sees what they'll draw with. */
  color?: string;
  tool?: 'pen' | 'eraser';
}

const RING_SCALE: Record<CursorState, number> = {
  normal: 1,
  neutral: 0.85,
  pinch: 0.65,
  point: 0.7,
  hover: 1.4,
  click: 0.5,
};

export default function HandCursor({ x, y, state, color, tool = 'pen' }: Props) {
  const isDrawing = state === 'pinch' || state === 'point';
  const isNeutral = state === 'neutral';
  const isHovering = state === 'hover';
  const isEraser = tool === 'eraser';

  // Dynamic ink or tool color fallback
  const effectiveColor = isEraser ? '#ffffff' : (color ?? '#00f0ff');

  return (
    <motion.div
      className="pointer-events-none fixed left-0 top-0 z-50 will-change-transform"
      style={{ x, y }}
    >
      {/* 1. DRAWING OUTER GLOW AURA (Pulsing Ambient Light) */}
      {isDrawing && (
        <motion.div
          className="absolute -translate-x-1/2 -translate-y-1/2 rounded-full pointer-events-none"
          initial={{ opacity: 0, scale: 0.8 }}
          animate={{
            opacity: [0.4, 0.85, 0.4],
            scale: [1.2, 1.7, 1.2],
          }}
          transition={{ repeat: Infinity, duration: 0.8, ease: 'easeInOut' }}
          style={{
            width: isEraser ? 48 : 36,
            height: isEraser ? 48 : 36,
            backgroundColor: effectiveColor,
            filter: isEraser ? 'blur(12px)' : 'blur(10px)',
          }}
        />
      )}

      {/* 2. CYBER RETICLE OUTER RING */}
      <motion.div
        className={`absolute -translate-x-1/2 -translate-y-1/2 rounded-full transition-colors duration-200 ${
          isEraser
            ? 'border-2 border-dashed border-rose-300/80 shadow-[0_0_20px_rgba(244,63,94,0.5)] bg-rose-500/10'
            : isDrawing
            ? 'border border-dashed border-cyan-300 shadow-[0_0_18px_rgba(0,240,255,0.85)]'
            : isNeutral
            ? 'border border-dotted border-slate-400/40 shadow-[0_0_8px_rgba(148,163,184,0.3)]'
            : isHovering
            ? 'border-2 border-solid border-cyan-300 shadow-[0_0_25px_rgba(0,240,255,0.8)] bg-cyan-400/10'
            : 'border border-dashed border-cyan-400/60 shadow-[0_0_12px_rgba(0,240,255,0.35)]'
        }`}
        initial={false}
        animate={{
          scale: RING_SCALE[state] ?? 1,
          width: isEraser ? 52 : 40,
          height: isEraser ? 52 : 40,
          rotate: isDrawing ? 90 : isNeutral ? 45 : isHovering ? 180 : 0,
        }}
        transition={{ type: 'spring', stiffness: 400, damping: 28 }}
      />

      {/* 3. CROSSHAIR PRECISION MARKS */}
      <motion.div
        className="absolute -translate-x-1/2 -translate-y-1/2 pointer-events-none"
        animate={{
          scale: isDrawing ? 0.75 : isHovering ? 1.25 : 1,
          rotate: isDrawing ? 45 : 0,
        }}
        transition={{ type: 'spring', stiffness: 450, damping: 25 }}
      >
        <div className="absolute -left-[18px] top-0 h-[2px] w-2 bg-cyan-300/90 -translate-y-1/2 shadow-[0_0_4px_#00f0ff]" />
        <div className="absolute left-[10px] top-0 h-[2px] w-2 bg-cyan-300/90 -translate-y-1/2 shadow-[0_0_4px_#00f0ff]" />
        <div className="absolute top-[10px] left-0 w-[2px] h-2 bg-cyan-300/90 -translate-x-1/2 shadow-[0_0_4px_#00f0ff]" />
        <div className="absolute -top-[18px] left-0 w-[2px] h-2 bg-cyan-300/90 -translate-x-1/2 shadow-[0_0_4px_#00f0ff]" />
      </motion.div>

      {/* 4. DYNAMIC CORE TIP (PRECISION DOT) */}
      <motion.div
        className="absolute -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white shadow-[0_0_10px_rgba(255,255,255,1)]"
        style={{ backgroundColor: effectiveColor }}
        initial={false}
        animate={{
          scale: isDrawing ? 1.5 : isHovering ? 1.2 : 1,
          width: isEraser ? 14 : 12,
          height: isEraser ? 14 : 12,
        }}
        transition={{ type: 'spring', stiffness: 500, damping: 25 }}
      />

      {/* 5. FLOATING STATE MINI-BADGE */}
      {(isDrawing || isHovering || isEraser) && (
        <motion.div
          initial={{ opacity: 0, x: 12, y: 12, scale: 0.8 }}
          animate={{ opacity: 1, x: 18, y: 14, scale: 1 }}
          exit={{ opacity: 0, scale: 0.8 }}
          transition={{ type: 'spring', stiffness: 500, damping: 30 }}
          className={`absolute left-0 top-0 flex items-center gap-1.5 rounded-md px-2 py-0.5 text-[9px] font-black tracking-widest uppercase backdrop-blur-md border shadow-lg ${
            isEraser
              ? 'bg-rose-950/90 text-rose-300 border-rose-500/50 shadow-rose-500/20'
              : isDrawing
              ? 'bg-slate-950/90 text-cyan-300 border-cyan-400/50 shadow-cyan-500/20'
              : 'bg-cyan-950/90 text-cyan-200 border-cyan-300/60 shadow-cyan-400/30'
          }`}
        >
          <span>{isEraser ? '🧹' : state === 'point' ? '☝️' : isHovering ? '🎯' : '✍️'}</span>
          <span>
            {isEraser
              ? 'ERASE'
              : state === 'point'
              ? 'AIR PEN'
              : isHovering
              ? 'SELECT'
              : 'DRAW'}
          </span>
        </motion.div>
      )}

      {/* 6. CLICK / PINCH RIPPLE ANIMATION */}
      {state === 'click' && (
        <motion.div
          className="absolute -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-cyan-200"
          initial={{ scale: 0.3, opacity: 1, width: 48, height: 48 }}
          animate={{ scale: 2.4, opacity: 0 }}
          transition={{ duration: 0.3, ease: 'easeOut' }}
        />
      )}
    </motion.div>
  );
}