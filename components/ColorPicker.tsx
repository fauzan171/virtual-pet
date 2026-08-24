'use client';

import { motion } from 'framer-motion';
import { COLORS } from '@/lib/constants';

interface Props {
  selected: string;
  hovered: string | null;
  registerRect(color: string, rect: DOMRect | null): void;
}

/**
 * Color palette shown centered on the canvas. Opened with the two-finger
 * gesture (index + middle extended). Hand-controlled: hover + pinch or dwell
 * selects. The chosen color becomes the stroke ink and cursor tint.
 */
export default function ColorPicker({ selected, hovered, registerRect }: Props) {
  return (
    <div className="absolute left-1/2 top-1/2 z-30 -translate-x-1/2 -translate-y-1/2 rounded-3xl bg-slate-950/85 p-8 backdrop-blur-2xl border border-cyan-400/30 shadow-[0_25px_70px_rgba(0,0,0,0.9),0_0_30px_rgba(0,240,255,0.25)]">
      <div className="flex items-center justify-center gap-2 mb-6">
        <span className="text-xl">✌️</span>
        <p className="text-center text-sm font-bold tracking-[0.25em] text-cyan-200">
          CHOOSE COLOR ✦ 2 FINGERS TO CLOSE
        </p>
      </div>
      <div className="flex flex-wrap items-center justify-center gap-5 max-w-[540px]">
        {COLORS.map((color) => {
          const active = selected === color;
          const isHovered = hovered === color;
          return (
            <motion.button
              key={color}
              ref={(el) => registerRect(color, el ? el.getBoundingClientRect() : null)}
              initial={false}
              animate={{
                scale: isHovered ? 1.2 : active ? 1.1 : 1,
              }}
              transition={{ type: 'spring', stiffness: 400, damping: 25 }}
              className={`h-14 w-14 rounded-full transition-all ${
                active
                  ? 'ring-4 ring-white shadow-[0_0_20px_rgba(255,255,255,0.9)]'
                  : isHovered
                  ? 'ring-4 ring-cyan-400 shadow-[0_0_15px_rgba(0,240,255,0.7)]'
                  : 'ring-2 ring-white/25 hover:ring-white/60'
              }`}
              style={{
                backgroundColor: color,
                border: color === '#1a1a2e' ? '2px solid rgba(255,255,255,0.4)' : undefined,
              }}
              aria-label={`color ${color}`}
            />
          );
        })}
      </div>
    </div>
  );
}

