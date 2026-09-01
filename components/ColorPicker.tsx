'use client';

import { motion } from 'framer-motion';
import { COLORS, MAX_BRUSH_SIZE, MIN_BRUSH_SIZE } from '@/lib/constants';

interface Props {
  selected: string;
  hovered: string | null;
  brushSize: number;
  registerRect(color: string, rect: DOMRect | null): void;
  registerBrushSliderRect(rect: DOMRect | null): void;
}

/**
 * Color palette shown centered on the canvas. Opened with the two-finger
 * gesture (index + middle extended). Hand-controlled: hover + pinch
 * selects. The chosen color becomes the stroke ink and cursor tint.
 */
export default function ColorPicker({
  selected,
  hovered,
  brushSize,
  registerRect,
  registerBrushSliderRect,
}: Props) {
  const progress = (brushSize - MIN_BRUSH_SIZE) / (MAX_BRUSH_SIZE - MIN_BRUSH_SIZE);

  return (
    <div className="absolute left-1/2 top-1/2 z-30 -translate-x-1/2 -translate-y-1/2 rounded-3xl bg-[#050510]/80 p-8 backdrop-blur-md ring-1 ring-white/20">
      <p className="mb-5 text-center text-sm tracking-[0.25em] text-slate-300">
        PICK A COLOR ✦ AIM + HOLD TO SELECT ✦ TWO FINGERS TO CLOSE
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

      <div className="mt-8 border-t border-white/10 pt-6">
        <div className="mb-3 flex items-center justify-between text-xs font-bold tracking-[0.2em] text-slate-300">
          <span>BRUSH SIZE</span>
          <span className="text-cyan-300">{brushSize} PX</span>
        </div>
        <div
          ref={(el) => registerBrushSliderRect(el ? el.getBoundingClientRect() : null)}
          className="relative flex h-14 w-full items-center"
          role="slider"
          aria-label="Brush size"
          aria-valuemin={MIN_BRUSH_SIZE}
          aria-valuemax={MAX_BRUSH_SIZE}
          aria-valuenow={brushSize}
        >
          <div className="h-2 w-full rounded-full bg-white/15">
            <div
              className="h-full rounded-full bg-gradient-to-r from-cyan-500 to-cyan-200 shadow-[0_0_18px_rgba(34,211,238,.5)]"
              style={{ width: `${progress * 100}%` }}
            />
          </div>
          <div
            className="pointer-events-none absolute top-1/2 flex -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border-2 border-white bg-cyan-300 shadow-[0_0_22px_rgba(34,211,238,.8)]"
            style={{
              left: `${progress * 100}%`,
              width: `${Math.max(20, brushSize + 10)}px`,
              height: `${Math.max(20, brushSize + 10)}px`,
            }}
          />
        </div>
        <p className="mt-2 text-center text-[10px] tracking-[0.18em] text-white/45">
          PINCH THE BAR + SLIDE LEFT OR RIGHT
        </p>
      </div>
    </div>
  );
}
