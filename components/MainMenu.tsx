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
    <div className="absolute inset-0 z-40 flex flex-col items-center justify-center gap-10 bg-[#050510]/90 backdrop-blur">
      <h2 className="text-3xl font-bold tracking-[0.3em] text-white">MENU</h2>

      {/* Actions */}
      <div className="flex items-center gap-6">
        <MenuButton
          label={undoConfirming ? 'CLICK AGAIN TO UNDO' : 'UNDO'}
          hovered={hoveredButton === 'UNDO'}
          onClick={onUndo}
          registerRect={(rect) => registerRect('UNDO', rect)}
          className={undoConfirming ? 'bg-amber-500/20 text-amber-300 ring-amber-400 animate-pulse' : ''}
        />
        <MenuButton
          label={clearConfirming ? 'CLICK AGAIN TO CLEAR' : 'CLEAR'}
          hovered={hoveredButton === 'CLEAR'}
          onClick={onClear}
          registerRect={(rect) => registerRect('CLEAR', rect)}
          className={clearConfirming ? 'bg-red-500/20 text-red-300 ring-red-400 animate-pulse' : ''}
        />
        <MenuButton
          label="GENERATE ✦"
          hovered={hoveredButton === 'GENERATE'}
          disabled={generateDisabled}
          onClick={onGenerate}
          registerRect={(rect) => registerRect('GENERATE', rect)}
          className="bg-gradient-to-r from-violet-500/20 to-cyan-400/20"
        />
      </div>

      {/* Style selection */}
      <div className="flex flex-col items-center gap-4">
        <p className="text-sm tracking-[0.25em] text-slate-400">STYLE</p>
        <div className="flex items-center gap-4">
          {(Object.keys(STYLES) as StyleKey[]).map((key) => {
            const active = selectedStyle === key;
            return (
              <motion.button
                key={key}
                ref={(el) => registerStyleRect(key, el ? el.getBoundingClientRect() : null)}
                initial={false}
                animate={{ scale: hoveredStyle === key ? 1.1 : 1 }}
                transition={{ duration: 0.12 }}
                className={`min-h-[52px] min-w-[130px] rounded-xl px-5 text-lg font-semibold tracking-wider transition-colors ${
                  active
                    ? 'bg-cyan-400/30 text-cyan-100 ring-2 ring-cyan-300'
                    : hoveredStyle === key
                    ? 'bg-white/10 text-white ring-1 ring-white/30'
                    : 'bg-white/5 text-slate-400 ring-1 ring-white/10'
                }`}
              >
                {key}
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
        className="min-h-[64px] min-w-[160px] bg-white/5 text-slate-300"
      />
      <p className="text-xs tracking-[0.25em] text-slate-500">
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
      animate={{ scale: hovered ? 1.12 : 1 }}
      transition={{ duration: 0.12 }}
      disabled={disabled}
      className={`min-h-[84px] min-w-[180px] rounded-2xl px-8 text-2xl font-bold tracking-wide transition-colors ${
        hovered
          ? 'bg-cyan-400/20 text-cyan-200 ring-2 ring-cyan-300'
          : 'bg-white/5 text-slate-300 ring-1 ring-white/10'
      } ${disabled ? 'opacity-30' : ''} ${className}`}
    >
      {label}
    </motion.button>
  );
}
