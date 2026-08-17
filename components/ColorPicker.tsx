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
    <div className="absolute left-1/2 top-1/2 z-30 -translate-x-1/2 -translate-y-1/2 rounded-3xl bg-[#050510]/80 p-8 backdrop-blur-md ring-1 ring-white/20">
      <p className="mb-5 text-center text-sm tracking-[0.25em] text-slate-300">
        PICK A COLOR ✦ TWO FINGERS TO CLOSE
      </p>
      <div className="flex items-center gap-6">
      {COLORS.map((color) => {
        const active = selected === color;
        return (
          <motion.button
            key={color}
            ref={(el) => registerRect(color, el ? el.getBoundingClientRect() : null)}
            initial={false}
            animate={{ scale: hovered === color ? 1.15 : 1 }}
            transition={{ duration: 0.12 }}
            className={`h-16 w-16 rounded-full ring-offset-2 ring-offset-[#050510] ${
              active
                ? 'ring-4 ring-white'
                : hovered === color
                ? 'ring-2 ring-white/60'
                : 'ring-1 ring-white/20'
            }`}
            style={{ backgroundColor: color }}
            aria-label={`color ${color}`}
          />
        );
      })}
      </div>
    </div>
  );
}
