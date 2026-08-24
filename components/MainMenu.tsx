'use client';

import { motion } from 'framer-motion';
import type { ButtonId } from '@/lib/types';
import { STYLES, type StyleKey } from '@/lib/prompt';

interface Props {
  hoveredButton: ButtonId | null;
  hoveredStyle: StyleKey | null;
  selectedStyle: StyleKey | null;
  clearConfirming: boolean;
  undoConfirming: boolean;
  generateDisabled: boolean;
  onUndo(): void;
  onClear(): void;
  onGenerate(): void;
  onClose(): void;
  registerRect(id: ButtonId, rect: DOMRect | null): void;
  registerStyleRect(style: StyleKey, rect: DOMRect | null): void;
}

/**
 * Full-screen menu summoned with the 5-finger gesture. Contains everything
 * that used to live in the always-visible button bar + style chips, so the
 * canvas is free of controls while drawing. Items are picked by resting the
 * cursor on them (dwell) or pinching.
 */
export default function MainMenu({
  hoveredButton,
  hoveredStyle,
  selectedStyle,
  clearConfirming,
  undoConfirming,
  generateDisabled,
  onUndo,
  onClear,
  onGenerate,
  onClose,
  registerRect,
  registerStyleRect,
}: Props) {
  return (
    <div className="absolute inset-0 z-40 flex flex-col items-center justify-center gap-8 bg-slate-950/90 backdrop-blur-2xl">
      <div className="flex items-center gap-3">
        <span className="text-3xl">🖐️</span>
        <h2 className="text-3xl font-black tracking-[0.35em] text-white">
          MAIN CONTROL
        </h2>
      </div>

      {/* Actions */}
      <div className="flex items-center gap-6">
        <MenuButton
          label={undoConfirming ? 'CONFIRM UNDO' : '↶ UNDO'}
          hovered={hoveredButton === 'UNDO'}
          onClick={onUndo}
          registerRect={(rect) => registerRect('UNDO', rect)}
          className={
            undoConfirming
              ? 'bg-amber-500/30 text-amber-200 border-amber-400 animate-pulse'
              : ''
          }
        />
        <MenuButton
          label={clearConfirming ? 'CONFIRM CLEAR' : '✕ CLEAR'}
          hovered={hoveredButton === 'CLEAR'}
          onClick={onClear}
          registerRect={(rect) => registerRect('CLEAR', rect)}
          className={
            clearConfirming
              ? 'bg-red-500/30 text-red-200 border-red-400 animate-pulse'
              : ''
          }
        />
        <MenuButton
          label="GENERATE ✦"
          hovered={hoveredButton === 'GENERATE'}
          disabled={generateDisabled}
          onClick={onGenerate}
          registerRect={(rect) => registerRect('GENERATE', rect)}
          className="bg-gradient-to-r from-violet-600/30 via-indigo-500/30 to-cyan-400/30 border-cyan-400/50 shadow-[0_0_25px_rgba(0,240,255,0.25)] text-cyan-200"
        />
      </div>

      {/* Style selection */}
      <div className="flex flex-col items-center gap-3 mt-2">
        <p className="text-xs font-bold tracking-[0.3em] text-cyan-300">
          AI GENERATION STYLE
        </p>
        <div className="flex flex-wrap items-center justify-center gap-4 max-w-[700px]">
          {(Object.keys(STYLES) as StyleKey[]).map((key) => {
            const active = selectedStyle === key;
            const isHovered = hoveredStyle === key;
            return (
              <motion.button
                key={key}
                ref={(el) => registerStyleRect(key, el ? el.getBoundingClientRect() : null)}
                initial={false}
                animate={{ scale: isHovered ? 1.12 : active ? 1.05 : 1 }}
                transition={{ type: 'spring', stiffness: 400, damping: 25 }}
                className={`min-h-[48px] min-w-[130px] rounded-xl px-5 text-sm font-bold tracking-wider transition-all ${
                  active
                    ? 'bg-cyan-500/30 text-cyan-100 border-2 border-cyan-300 shadow-[0_0_20px_rgba(0,240,255,0.5)]'
                    : isHovered
                    ? 'bg-white/15 text-white border border-white/40 shadow-[0_0_12px_rgba(255,255,255,0.3)]'
                    : 'bg-white/5 text-slate-400 border border-white/10 hover:text-white'
                }`}
              >
                {key.toUpperCase()}
              </motion.button>
            );
          })}
        </div>
      </div>

      <MenuButton
        label="✕ CLOSE"
        hovered={hoveredButton === 'CLOSE'}
        onClick={onClose}
        registerRect={(rect) => registerRect('CLOSE', rect)}
        className="min-h-[56px] min-w-[160px] bg-white/5 text-slate-300 border-white/15"
      />
      <p className="text-xs tracking-[0.25em] text-slate-400">
        RAISE 5 FINGERS AGAIN TO CLOSE
      </p>
    </div>
  );
}

function MenuButton({
  label,
  hovered,
  disabled,
  onClick,
  registerRect,
  className = '',
}: {
  label: string;
  hovered: boolean;
  disabled?: boolean;
  onClick(): void;
  registerRect(rect: DOMRect | null): void;
  className?: string;
}) {
  return (
    <motion.button
      ref={(el) => registerRect(el ? el.getBoundingClientRect() : null)}
      onClick={onClick}
      initial={false}
      animate={{ scale: hovered ? 1.1 : 1 }}
      transition={{ type: 'spring', stiffness: 400, damping: 25 }}
      disabled={disabled}
      className={`min-h-[76px] min-w-[180px] rounded-2xl px-7 text-xl font-extrabold tracking-wider transition-all border ${
        hovered
          ? 'bg-cyan-500/25 text-cyan-100 border-cyan-300 shadow-[0_0_20px_rgba(0,240,255,0.4)]'
          : 'bg-white/5 text-slate-200 border-white/15 hover:border-white/30'
      } ${disabled ? 'opacity-30 cursor-not-allowed' : ''} ${className}`}
    >
      {label}
    </motion.button>
  );
}

