'use client';

import { motion } from 'framer-motion';
import type { ButtonId } from '@/lib/types';
import type { StyleKey } from '@/lib/prompt';

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
  onSelectStyle(style: StyleKey): void;
  onClose(): void;
  registerRect(id: ButtonId, rect: DOMRect | null): void;
  registerStyleRect(style: StyleKey, rect: DOMRect | null): void;
}

const BUTTON_LABELS: Record<ButtonId, string> = {
  UNDO: 'UNDO',
  CLEAR: 'CLEAR',
  GENERATE: 'GENERATE AI',
  CLOSE: 'CLOSE',
};

const WHEEL_NODES = [
  { kind: 'action', key: 'GENERATE', label: 'GENERATE AI', hint: 'CREATE', angle: -90 },
  { kind: 'style', key: 'CINEMATIC', label: 'CINEMATIC', angle: -45 },
  { kind: 'action', key: 'CLEAR', label: 'CLEAR', hint: 'CANVAS', angle: 0 },
  { kind: 'style', key: '3D', label: '3D', angle: 45 },
  { kind: 'action', key: 'CLOSE', label: 'CLOSE', hint: 'EXIT', angle: 90 },
  { kind: 'style', key: 'FUTURISTIC', label: 'FUTURISTIC', angle: 135 },
  { kind: 'action', key: 'UNDO', label: 'UNDO', hint: 'LAST STROKE', angle: 180 },
  { kind: 'style', key: 'REALISTIC', label: 'REALISTIC', angle: 225 },
] as const satisfies readonly (
  | { kind: 'action'; key: ButtonId; label: string; hint: string; angle: number }
  | { kind: 'style'; key: StyleKey; label: string; angle: number }
)[];

/**
 * Stage command wheel summoned by a five-finger open palm. Its game-like
 * silhouette is quick to read, while every node remains a generous rectangular
 * hit target for noisy hand tracking, pinch selection, and mouse fallback.
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
  onSelectStyle,
  onClose,
  registerRect,
  registerStyleRect,
}: Props) {
  const activeLabel = hoveredButton
    ? BUTTON_LABELS[hoveredButton]
    : hoveredStyle
      ? `${hoveredStyle} STYLE`
      : selectedStyle
        ? `${selectedStyle} ARMED`
        : 'COMMAND WHEEL';

  return (
    <motion.div
      className="absolute inset-0 z-40 overflow-hidden bg-[#02060b]/95"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.1 }}
    >
      <div
        className="pointer-events-none absolute inset-0 opacity-50"
        style={{
          backgroundImage:
            'radial-gradient(circle at center, rgba(34,211,238,.12), transparent 38%), linear-gradient(rgba(255,255,255,.025) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,.025) 1px, transparent 1px)',
          backgroundSize: 'auto, 42px 42px, 42px 42px',
        }}
      />

      <div className="absolute left-7 top-6 font-mono text-[11px] tracking-[0.32em] text-cyan-200/60">
        AIR CANVAS / COMMAND SELECT
      </div>
      <div className="absolute right-7 top-6 text-right font-mono text-[11px] tracking-[0.24em] text-white/40">
        AIM + HOLD TO SELECT<br />PINCH ALSO WORKS · OPEN PALM TO EXIT
      </div>

      <div className="absolute left-1/2 top-1/2 h-[min(82vh,720px)] w-[min(82vh,720px)] -translate-x-1/2 -translate-y-1/2">
        <motion.div
          className="pointer-events-none absolute inset-[13%] rounded-full border border-cyan-200/20 shadow-[0_0_90px_rgba(34,211,238,0.08),inset_0_0_60px_rgba(34,211,238,0.05)]"
          initial={{ scale: 0.7, rotate: -12, opacity: 0 }}
          animate={{ scale: 1, rotate: 0, opacity: 1 }}
          transition={{ type: 'spring', stiffness: 260, damping: 26 }}
        >
          <div className="absolute inset-[8%] rounded-full border border-dashed border-white/10" />
          <div className="absolute inset-[28%] rounded-full border border-cyan-200/15 bg-black/35" />
        </motion.div>

        {WHEEL_NODES.map((node, index) => {
          const radians = (node.angle * Math.PI) / 180;
          const position = {
            left: `${50 + Math.cos(radians) * 38}%`,
            top: `${50 + Math.sin(radians) * 38}%`,
          };
          const hovered = node.kind === 'action'
            ? hoveredButton === node.key
            : hoveredStyle === node.key;
          const active = node.kind === 'style' && selectedStyle === node.key;
          const confirming =
            (node.kind === 'action' && node.key === 'UNDO' && undoConfirming) ||
            (node.kind === 'action' && node.key === 'CLEAR' && clearConfirming);
          const disabled = node.kind === 'action' && node.key === 'GENERATE' && generateDisabled;
          const click = node.kind === 'style'
            ? () => onSelectStyle(node.key)
            : node.key === 'UNDO'
              ? onUndo
              : node.key === 'CLEAR'
                ? onClear
                : node.key === 'GENERATE'
                  ? onGenerate
                  : onClose;

          return (
            <div key={node.key}>
              <div
                className="pointer-events-none absolute left-1/2 top-1/2 h-px w-[38%] origin-left bg-gradient-to-r from-cyan-300/20 to-transparent"
                style={{ transform: `rotate(${node.angle}deg)` }}
              />
              <motion.button
                ref={(el) => {
                  const rect = el ? el.getBoundingClientRect() : null;
                  if (node.kind === 'action') registerRect(node.key, rect);
                  else registerStyleRect(node.key, rect);
                }}
                onClick={click}
                disabled={disabled}
                aria-label={node.label}
                className={`absolute z-10 flex h-[78px] w-[154px] -translate-x-1/2 -translate-y-1/2 flex-col items-center justify-center overflow-hidden rounded-[18px] border px-3 font-mono uppercase transition-colors ${
                  confirming
                    ? 'animate-pulse border-amber-300 bg-amber-400/20 text-amber-100 shadow-[0_0_36px_rgba(251,191,36,.32)]'
                    : hovered
                      ? 'border-cyan-200 bg-cyan-300/20 text-white shadow-[0_0_42px_rgba(34,211,238,.38)]'
                      : active
                        ? 'border-cyan-300/70 bg-cyan-300/10 text-cyan-100 shadow-[0_0_24px_rgba(34,211,238,.18)]'
                        : node.key === 'GENERATE'
                          ? 'border-amber-300/50 bg-amber-300/10 text-amber-100 shadow-[0_0_28px_rgba(251,191,36,.12)]'
                          : 'border-white/15 bg-[#07111b]/92 text-slate-300 shadow-[0_16px_32px_rgba(0,0,0,.45)]'
                } ${disabled ? 'opacity-30' : ''}`}
                style={position}
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ delay: index * 0.01, duration: 0.15 }}
              >
                <span className="text-[10px] tracking-[0.3em] opacity-55">
                  {node.kind === 'style' ? 'STYLE' : node.hint}
                </span>
                <span className="mt-1 text-[15px] font-black tracking-[0.16em]">
                  {confirming ? 'CONFIRM?' : node.label}
                </span>
                {hovered && <span className="absolute bottom-0 h-[3px] w-full bg-cyan-200" />}
              </motion.button>
            </div>
          );
        })}

        <motion.div
          className="pointer-events-none absolute left-1/2 top-1/2 z-0 flex h-40 w-40 -translate-x-1/2 -translate-y-1/2 flex-col items-center justify-center rounded-full border border-cyan-200/30 bg-[#030a12]/95 text-center shadow-[0_0_55px_rgba(34,211,238,.18)]"
          animate={{ scale: hoveredButton || hoveredStyle ? 1.04 : 1 }}
        >
          <span className="text-[9px] tracking-[0.36em] text-cyan-200/55">SELECTED</span>
          <span className="mt-2 max-w-28 text-sm font-black tracking-[0.12em] text-white">{activeLabel}</span>
          <span className="mt-3 text-[9px] tracking-[0.2em] text-white/35">5 FINGERS / CLOSE</span>
        </motion.div>
      </div>

    </motion.div>
  );
}
