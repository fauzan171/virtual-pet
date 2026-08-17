'use client';

import { motion } from 'framer-motion';
import type { ButtonId } from '@/lib/types';

interface Props {
  hovered: ButtonId | null;
  clearConfirming: boolean;
  generateDisabled: boolean;
  onUndo(): void;
  onClear(): void;
  onGenerate(): void;
  registerRect(id: ButtonId, rect: DOMRect | null): void;
}

function VirtualButton({
  id,
  label,
  hovered,
  disabled,
  onClick,
  registerRect,
  className = '',
}: {
  id: ButtonId;
  label: string;
  hovered: boolean;
  disabled?: boolean;
  onClick(): void;
  registerRect(id: ButtonId, rect: DOMRect | null): void;
  className?: string;
}) {
  return (
    <motion.button
      ref={(el) => registerRect(id, el ? el.getBoundingClientRect() : null)}
      onClick={onClick}
      initial={false}
      animate={{ scale: hovered ? 1.12 : 1 }}
      transition={{ duration: 0.12 }}
      disabled={disabled}
      className={`min-h-[84px] min-w-[180px] rounded-2xl px-10 text-2xl font-bold tracking-wide transition-colors ${
        hovered
          ? 'bg-cyan-400/20 text-cyan-200 ring-2 ring-cyan-300'
          : 'bg-white/5 text-slate-300 ring-1 ring-white/10'
      } ${disabled ? 'opacity-30' : ''} ${className}`}
    >
      {label}
    </motion.button>
  );
}

export default function ButtonBar({
  hovered,
  clearConfirming,
  generateDisabled,
  onUndo,
  onClear,
  onGenerate,
  registerRect,
}: Props) {
  return (
    <div className="absolute bottom-8 left-1/2 z-20 flex -translate-x-1/2 items-center gap-8">
      <VirtualButton
        id="UNDO"
        label="UNDO"
        hovered={hovered === 'UNDO'}
        onClick={onUndo}
        registerRect={registerRect}
      />
      <VirtualButton
        id="CLEAR"
        label={clearConfirming ? 'CONFIRM?' : 'CLEAR'}
        hovered={hovered === 'CLEAR'}
        onClick={onClear}
        registerRect={registerRect}
        className={clearConfirming ? 'bg-red-500/20 text-red-300 ring-red-400' : ''}
      />
      <VirtualButton
        id="GENERATE"
        label="GENERATE ✦"
        hovered={hovered === 'GENERATE'}
        disabled={generateDisabled}
        onClick={onGenerate}
        registerRect={registerRect}
        className="bg-gradient-to-r from-violet-500/20 to-cyan-400/20 text-xl"
      />
    </div>
  );
}
