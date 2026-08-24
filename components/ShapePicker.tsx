'use client';

import { motion } from 'framer-motion';
import type { ShapeId } from '@/lib/types';

export const SHAPES: ShapeId[] = [
  'line',
  'arrow',
  'curve',
  'circle',
  'square',
  'rectangle',
  'triangle',
  'star',
  'heart',
];

const LABELS: Record<ShapeId, string> = {
  line: 'LINE',
  arrow: 'ARROW',
  curve: 'CURVE',
  circle: 'CIRCLE',
  square: 'SQUARE',
  rectangle: 'RECT',
  triangle: 'TRIANGLE',
  star: 'STAR',
  heart: 'HEART',
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
    <div className="absolute left-1/2 top-1/2 z-30 -translate-x-1/2 -translate-y-1/2 rounded-3xl bg-slate-950/85 p-8 backdrop-blur-2xl border border-amber-400/30 shadow-[0_25px_70px_rgba(0,0,0,0.9),0_0_30px_rgba(251,191,36,0.2)]">
      <div className="flex items-center justify-center gap-2 mb-6">
        <span className="text-xl">🤟</span>
        <p className="text-center text-sm font-bold tracking-[0.25em] text-amber-200">
          SELECT SHAPE ✦ 3 FINGERS TO CLOSE
        </p>
      </div>
      <div className="flex flex-wrap items-center justify-center gap-4 max-w-[500px]">
        {SHAPES.map((shape) => {
          const active = selected === shape;
          const isHovered = hovered === shape;
          return (
            <motion.button
              key={shape}
              ref={(el) => registerRect(shape, el ? el.getBoundingClientRect() : null)}
              initial={false}
              animate={{ scale: isHovered ? 1.15 : active ? 1.08 : 1 }}
              transition={{ type: 'spring', stiffness: 400, damping: 25 }}
              className={`flex h-20 w-20 flex-col items-center justify-center gap-1.5 rounded-2xl transition-all ${
                active
                  ? 'bg-amber-500/30 border-2 border-amber-300 shadow-[0_0_20px_rgba(251,191,36,0.6)]'
                  : isHovered
                  ? 'bg-white/15 border-2 border-cyan-400 shadow-[0_0_15px_rgba(0,240,255,0.5)]'
                  : 'bg-white/5 border border-white/15 hover:bg-white/10'
              }`}
              aria-label={LABELS[shape]}
            >
              <ShapeIcon shape={shape} active={active || isHovered} />
              <span className={`text-[10px] font-bold tracking-widest ${active ? 'text-amber-200' : isHovered ? 'text-cyan-200' : 'text-slate-300'}`}>
                {LABELS[shape]}
              </span>
            </motion.button>
          );
        })}
      </div>
    </div>
  );
}

function ShapeIcon({ shape, active }: { shape: ShapeId; active?: boolean }) {
  const cls = `h-7 w-7 ${active ? 'stroke-white drop-shadow-[0_0_6px_rgba(255,255,255,0.8)]' : 'stroke-slate-300'} fill-none`;
  const sw = 2.2;
  switch (shape) {
    case 'line':
      return <svg viewBox="0 0 32 32" className={cls}><line x1="4" y1="28" x2="28" y2="4" strokeWidth={sw} strokeLinecap="round" /></svg>;
    case 'arrow':
      return <svg viewBox="0 0 32 32" className={cls}><line x1="6" y1="26" x2="26" y2="6" strokeWidth={sw} strokeLinecap="round" /><polyline points="14,6 26,6 26,18" strokeWidth={sw} strokeLinecap="round" strokeLinejoin="round" /></svg>;
    case 'curve':
      return <svg viewBox="0 0 32 32" className={cls}><path d="M4 24 Q16 2 28 20" strokeWidth={sw} strokeLinecap="round" /></svg>;
    case 'circle':
      return <svg viewBox="0 0 32 32" className={cls}><circle cx="16" cy="16" r="11" strokeWidth={sw} /></svg>;
    case 'square':
      return <svg viewBox="0 0 32 32" className={cls}><rect x="6" y="6" width="20" height="20" rx="3" strokeWidth={sw} /></svg>;
    case 'rectangle':
      return <svg viewBox="0 0 32 32" className={cls}><rect x="4" y="8" width="24" height="16" rx="3" strokeWidth={sw} /></svg>;
    case 'triangle':
      return <svg viewBox="0 0 32 32" className={cls}><path d="M16 5 L27 26 L5 26 Z" strokeWidth={sw} strokeLinejoin="round" /></svg>;
    case 'star':
      return <svg viewBox="0 0 32 32" className={cls}><polygon points="16,3 20,12 30,13 22,20 25,30 16,24 7,30 10,20 2,13 12,12" strokeWidth={sw} strokeLinejoin="round" /></svg>;
    case 'heart':
      return <svg viewBox="0 0 32 32" className={cls}><path d="M16,28 C16,28 3,20 3,11 C3,6 7,3 11,3 C14,3 16,6 16,6 C16,6 18,3 21,3 C25,3 29,6 29,11 C29,20 16,28 16,28 Z" strokeWidth={sw} strokeLinejoin="round" /></svg>;
  }
}

