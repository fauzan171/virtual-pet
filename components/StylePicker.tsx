'use client';

import { motion } from 'framer-motion';
import { STYLES, type StyleKey } from '@/lib/prompt';

interface Props {
  selected: StyleKey | null;
  hovered: StyleKey | null;
  registerRect(style: StyleKey, rect: DOMRect | null): void;
}

/**
 * Style chips above the main button bar. Hand-controlled: hover + pinch selects.
 * Selection is appended to the generation prompt on the server side.
 */
export default function StylePicker({ selected, hovered, registerRect }: Props) {
  return (
    <div className="absolute bottom-32 left-1/2 z-20 flex -translate-x-1/2 items-center gap-5">
      {(Object.keys(STYLES) as StyleKey[]).map((key) => {
        const active = selected === key;
        return (
          <motion.button
            key={key}
            ref={(el) => registerRect(key, el ? el.getBoundingClientRect() : null)}
            initial={false}
            animate={{ scale: hovered === key ? 1.1 : 1 }}
            transition={{ duration: 0.12 }}
            className={`min-h-[56px] min-w-[140px] rounded-xl px-6 text-lg font-semibold tracking-wider transition-colors ${
              active
                ? 'bg-cyan-400/30 text-cyan-100 ring-2 ring-cyan-300'
                : hovered === key
                ? 'bg-white/10 text-white ring-1 ring-white/30'
                : 'bg-white/5 text-slate-400 ring-1 ring-white/10'
            }`}
          >
            {key}
          </motion.button>
        );
      })}
    </div>
  );
}
