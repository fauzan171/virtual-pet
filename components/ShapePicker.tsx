'use client';

import { motion } from 'framer-motion';
import type { ShapeId } from '@/lib/types';

export const SHAPES: ShapeId[] = ['line', 'curve', 'circle', 'square', 'triangle'];

const LABELS: Record<ShapeId, string> = {
  line: 'LINE',
  curve: 'CURVE',
  circle: 'CIRCLE',
  square: 'SQUARE',
  triangle: 'TRIANGLE',
};

interface Props {
  selected: ShapeId | null;
  hovered: ShapeId | null;
  registerRect(shape: ShapeId, rect: DOMRect | null): void;
}

/**
 * Shape palette shown centered on the canvas. Opened with the three-finger
 * gesture (index + middle + ring extended). Hover + pinch or dwell selects.
 * After selection the next pinch-drag draws that shape; release returns to pen.
 */
export default function ShapePicker({ selected, hovered, registerRect }: Props) {
  return (
    <div className="absolute left-1/2 top-1/2 z-30 -translate-x-1/2 -translate-y-1/2 rounded-3xl bg-[#050510]/80 p-8 backdrop-blur-md ring-1 ring-white/20">
      <p className="mb-5 text-center text-sm tracking-[0.25em] text-slate-300">
        PICK A SHAPE ✦ THREE FINGERS TO CLOSE
      </p>
      <div className="flex items-center gap-6">
        {SHAPES.map((shape) => {
          const active = selected === shape;
          return (
            <motion.button
              key={shape}
              ref={(el) => registerRect(shape, el ? el.getBoundingClientRect() : null)}
              initial={false}
              animate={{ scale: hovered === shape ? 1.15 : 1 }}
              transition={{ duration: 0.12 }}
              className={`flex h-20 w-20 flex-col items-center justify-center gap-1 rounded-2xl ring-offset-2 ring-offset-[#050510] ${
                active
                  ? 'bg-cyan-400/20 ring-4 ring-cyan-300'
                  : hovered === shape
                  ? 'bg-white/10 ring-2 ring-white/60'
                  : 'bg-white/5 ring-1 ring-white/20'
              }`}
              aria-label={LABELS[shape]}
            >
              <ShapeIcon shape={shape} />
              <span className="text-[10px] font-semibold tracking-widest text-slate-200">
                {LABELS[shape]}
              </span>
            </motion.button>
          );
        })}
      </div>
    </div>
  );
}

function ShapeIcon({ shape }: { shape: ShapeId }) {
  const cls = 'h-8 w-8 stroke-slate-100 fill-none';
  const sw = 2;
  switch (shape) {
    case 'line':
      return <svg viewBox="0 0 32 32" className={cls}><line x1="4" y1="28" x2="28" y2="4" strokeWidth={sw} /></svg>;
    case 'curve':
      return <svg viewBox="0 0 32 32" className={cls}><path d="M4 24 Q16 2 28 20" strokeWidth={sw} /></svg>;
    case 'circle':
      return <svg viewBox="0 0 32 32" className={cls}><circle cx="16" cy="16" r="12" strokeWidth={sw} /></svg>;
    case 'square':
      return <svg viewBox="0 0 32 32" className={cls}><rect x="5" y="5" width="22" height="22" strokeWidth={sw} /></svg>;
    case 'triangle':
      return <svg viewBox="0 0 32 32" className={cls}><path d="M16 4 L28 28 L4 28 Z" strokeWidth={sw} /></svg>;
  }
}
