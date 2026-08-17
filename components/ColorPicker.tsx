'use client';

import { motion } from 'framer-motion';
import { COLORS } from '@/lib/constants';

interface Props {
  selected: string;
  hovered: string | null;
  registerRect(color: string, rect: DOMRect | null): void;
}

/**
 * Vertical color palette on the right edge. Hand-controlled: hover + pinch
 * or dwell selects. The chosen color becomes the stroke ink and cursor tint.
 */
export default function ColorPicker({ selected, hovered, registerRect }: Props) {
  return (
    <div className="absolute right-6 top-1/2 z-20 flex -translate-y-1/2 flex-col items-center gap-3">
      {COLORS.map((color) => {
        const active = selected === color;
        return (
          <motion.button
            key={color}
            ref={(el) => registerRect(color, el ? el.getBoundingClientRect() : null)}
            initial={false}
            animate={{ scale: hovered === color ? 1.15 : 1 }}
            transition={{ duration: 0.12 }}
            className={`h-14 w-14 rounded-full ring-offset-2 ring-offset-[#050510] ${
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
  );
}
