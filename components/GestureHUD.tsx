'use client';

import { motion, AnimatePresence } from 'framer-motion';
import type { DrawMode, GestureType, ShapeId, ToolId } from '@/lib/types';
import { BRUSH_SIZES } from '@/lib/constants';

interface Props {
  gesture: GestureType;
  isDrawing: boolean;
  drawMode: DrawMode;
  autoShape: boolean;
  activeShape: ShapeId | null;
  detectedShapeToast: string | null;
  brushSize: number;
  glowMode: boolean;
  canUndo: boolean;
  canRedo: boolean;
  tool: ToolId;
  paletteOpen?: boolean;
  shapePickerOpen?: boolean;
  onToggleDrawMode: () => void;
  onToggleAutoShape: () => void;
  onSelectBrushSize: (size: number) => void;
  onToggleGlow: () => void;
  onTogglePalette?: () => void;
  onToggleShapePicker?: () => void;
  onUndo: () => void;
  onRedo: () => void;
  onClear: () => void;
}

const GESTURE_INFO: Record<
  GestureType,
  { label: string; icon: string; badgeColor: string; glowColor: string }
> = {
  point: {
    label: 'Air Pen',
    icon: '☝️',
    badgeColor: 'bg-cyan-500/20 text-cyan-300 border-cyan-400/50',
    glowColor: 'shadow-[0_0_15px_rgba(0,240,255,0.3)]',
  },
  pinch: {
    label: 'Pinch Draw',
    icon: '👌',
    badgeColor: 'bg-emerald-500/20 text-emerald-300 border-emerald-400/50',
    glowColor: 'shadow-[0_0_15px_rgba(52,211,153,0.3)]',
  },
  peace: {
    label: 'Palette (2)',
    icon: '✌️',
    badgeColor: 'bg-purple-500/20 text-purple-300 border-purple-400/50',
    glowColor: 'shadow-[0_0_15px_rgba(192,132,252,0.3)]',
  },
  three: {
    label: 'Shapes (3)',
    icon: '🤟',
    badgeColor: 'bg-amber-500/20 text-amber-300 border-amber-400/50',
    glowColor: 'shadow-[0_0_15px_rgba(251,191,36,0.3)]',
  },
  open: {
    label: 'Menu (5)',
    icon: '🖐️',
    badgeColor: 'bg-rose-500/20 text-rose-300 border-rose-400/50',
    glowColor: 'shadow-[0_0_15px_rgba(244,63,94,0.3)]',
  },
  fist: {
    label: 'Neutral',
    icon: '✊',
    badgeColor: 'bg-slate-500/20 text-slate-300 border-slate-400/30',
    glowColor: '',
  },
  hover: {
    label: 'Air Cursor',
    icon: '✨',
    badgeColor: 'bg-cyan-500/20 text-cyan-200 border-cyan-400/40',
    glowColor: 'shadow-[0_0_12px_rgba(0,240,255,0.2)]',
  },
};

export default function GestureHUD({
  gesture,
  isDrawing,
  drawMode,
  autoShape,
  activeShape,
  detectedShapeToast,
  brushSize,
  glowMode,
  canUndo,
  canRedo,
  tool,
  paletteOpen,
  shapePickerOpen,
  onToggleDrawMode,
  onToggleAutoShape,
  onSelectBrushSize,
  onToggleGlow,
  onTogglePalette,
  onToggleShapePicker,
  onUndo,
  onRedo,
  onClear,
}: Props) {
  const current = GESTURE_INFO[gesture] || GESTURE_INFO.hover;

  return (
    <>
      {/* ── TOP-LEFT: STATUS & GESTURE INFO ── */}
      <div className="pointer-events-auto absolute left-6 top-6 z-40 flex items-center gap-3">
        {/* Main Status Pill */}
        <div className="flex items-center gap-2.5 rounded-2xl bg-slate-950/85 px-4 py-2.5 backdrop-blur-2xl border border-white/15 shadow-[0_12px_40px_rgba(0,0,0,0.7)]">
          {/* Live Gesture Indicator */}
          <motion.div
            className={`flex items-center gap-2 rounded-xl px-3 py-1.5 text-xs font-black border transition-all ${current.badgeColor} ${current.glowColor}`}
            animate={{ scale: isDrawing ? 1.04 : 1 }}
            transition={{ type: 'spring', stiffness: 400, damping: 25 }}
          >
            <span className="text-base">{tool === 'eraser' ? '🧹' : current.icon}</span>
            <span className="tracking-wider uppercase">
              {isDrawing ? (tool === 'eraser' ? 'ERASING' : 'DRAWING') : current.label}
            </span>
          </motion.div>

          <div className="h-5 w-[1px] bg-white/20" />

          {/* Draw Mode Switcher */}
          <motion.button
            whileHover={{ scale: 1.03 }}
            whileTap={{ scale: 0.95 }}
            onClick={onToggleDrawMode}
            title="Switch Draw Mode: Smart / Air Pen / Pinch (Key: P)"
            className="flex items-center gap-2 rounded-xl bg-white/5 hover:bg-white/10 px-3 py-1.5 text-xs font-bold text-slate-200 border border-white/10 transition shadow-sm"
          >
            <span className="text-cyan-400 font-extrabold">MODE:</span>
            <span className="capitalize text-white">
              {drawMode === 'smart'
                ? '⚡ Smart'
                : drawMode === 'point'
                ? '☝️ Air Pen'
                : '👌 Pinch'}
            </span>
            <kbd className="ml-1 rounded bg-white/10 px-1.5 py-0.5 text-[10px] font-mono text-cyan-300 border border-white/10">
              P
            </kbd>
          </motion.button>
        </div>
      </div>

      {/* ── TOP-CENTER: DETECTED SHAPE TOAST ── */}
      <AnimatePresence>
        {detectedShapeToast && (
          <motion.div
            initial={{ opacity: 0, y: -25, scale: 0.85 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -20, scale: 0.9 }}
            transition={{ type: 'spring', stiffness: 500, damping: 30 }}
            className="pointer-events-none absolute left-1/2 top-8 z-50 -translate-x-1/2 flex items-center gap-2.5 rounded-full bg-gradient-to-r from-amber-400 via-orange-400 to-amber-300 px-6 py-2.5 text-xs font-black uppercase tracking-widest text-slate-950 shadow-[0_0_35px_rgba(251,191,36,0.6)] border-2 border-white ring-4 ring-amber-500/30"
          >
            <span className="text-base animate-bounce">✨</span>
            <span>{detectedShapeToast}</span>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── TOP-RIGHT: UNIFIED COMPACT TOOLBAR DOCK ── */}
      <div className="pointer-events-auto absolute right-6 top-6 z-40 flex items-center gap-2">
        <div className="flex items-center gap-2 rounded-2xl bg-slate-950/85 p-2 backdrop-blur-2xl border border-white/15 shadow-[0_12px_40px_rgba(0,0,0,0.7)]">
          {/* Brush Sizes */}
          <div className="relative flex items-center bg-white/5 rounded-xl p-1 border border-white/10">
            {BRUSH_SIZES.map((b, idx) => {
              const isSelected = brushSize === b.size;
              return (
                <button
                  key={b.id}
                  onClick={() => onSelectBrushSize(b.size)}
                  title={`Brush Size: ${b.label} (Key: ${idx + 1})`}
                  className={`relative rounded-lg px-2.5 py-1 text-[11px] font-black transition-colors ${
                    isSelected
                      ? 'text-slate-950'
                      : 'text-slate-400 hover:text-white hover:bg-white/10'
                  }`}
                >
                  {isSelected && (
                    <motion.div
                      layoutId="brushSizeIndicator"
                      className="absolute inset-0 rounded-lg bg-cyan-400 shadow-[0_0_12px_rgba(0,240,255,0.6)]"
                      transition={{ type: 'spring', stiffness: 500, damping: 35 }}
                    />
                  )}
                  <span className="relative z-10">
                    {b.id === 'fine' ? 'S' : b.id === 'medium' ? 'M' : b.id === 'bold' ? 'L' : 'XL'}
                  </span>
                </button>
              );
            })}
          </div>

          <div className="h-5 w-[1px] bg-white/15" />

          {/* Neon Glow Toggle */}
          <motion.button
            whileHover={{ scale: 1.05 }}
            whileTap={{ scale: 0.93 }}
            onClick={onToggleGlow}
            title="Toggle Neon Glow Ink (Key: N)"
            className={`flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-xs font-bold transition-all border ${
              glowMode
                ? 'bg-cyan-500/25 border-cyan-400 text-cyan-200 shadow-[0_0_15px_rgba(0,240,255,0.4)]'
                : 'bg-white/5 border-white/10 text-slate-400 hover:text-white hover:bg-white/10'
            }`}
          >
            <span>💡</span>
            <span className="text-[11px] font-extrabold">NEON</span>
            <kbd className="ml-0.5 rounded bg-white/10 px-1 py-0.2 text-[9px] font-mono text-cyan-300">
              N
            </kbd>
          </motion.button>

          {/* Magic Shape Toggle */}
          <motion.button
            whileHover={{ scale: 1.05 }}
            whileTap={{ scale: 0.93 }}
            onClick={onToggleAutoShape}
            title="Toggle Magic Shape Snapping (Key: A)"
            className={`flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-xs font-bold transition-all border ${
              autoShape
                ? 'bg-amber-500/25 border-amber-400 text-amber-200 shadow-[0_0_15px_rgba(251,191,36,0.4)]'
                : 'bg-white/5 border-white/10 text-slate-400 hover:text-white hover:bg-white/10'
            }`}
          >
            <span>✨</span>
            <span className="text-[11px] font-extrabold">AUTO SHAPE</span>
            <kbd className="ml-0.5 rounded bg-white/10 px-1 py-0.2 text-[9px] font-mono text-amber-300">
              A
            </kbd>
          </motion.button>

          {/* Palette & Shapes Quick Buttons */}
          {onTogglePalette && (
            <motion.button
              whileHover={{ scale: 1.08 }}
              whileTap={{ scale: 0.9 }}
              onClick={onTogglePalette}
              title="Color Palette (2 Fingers or Key: V)"
              className={`flex items-center justify-center rounded-xl p-2 transition-all border ${
                paletteOpen
                  ? 'bg-purple-500/35 border-purple-400 text-white shadow-[0_0_15px_rgba(192,132,252,0.5)]'
                  : 'bg-white/5 border-white/10 text-slate-300 hover:bg-white/10 hover:text-white'
              }`}
            >
              <span className="text-base">🎨</span>
            </motion.button>
          )}

          {onToggleShapePicker && (
            <motion.button
              whileHover={{ scale: 1.08 }}
              whileTap={{ scale: 0.9 }}
              onClick={onToggleShapePicker}
              title="Shape Library (3 Fingers)"
              className={`flex items-center justify-center rounded-xl p-2 transition-all border ${
                shapePickerOpen || activeShape
                  ? 'bg-amber-500/35 border-amber-400 text-white shadow-[0_0_15px_rgba(251,191,36,0.5)]'
                  : 'bg-white/5 border-white/10 text-slate-300 hover:bg-white/10 hover:text-white'
              }`}
            >
              <span className="text-base">📐</span>
            </motion.button>
          )}

          <div className="h-5 w-[1px] bg-white/15" />

          {/* Undo / Redo / Clear Actions */}
          <div className="flex items-center gap-1.5">
            <motion.button
              whileHover={{ scale: canUndo ? 1.08 : 1 }}
              whileTap={{ scale: canUndo ? 0.9 : 1 }}
              onClick={onUndo}
              disabled={!canUndo}
              title="Undo (Key: Z)"
              className={`rounded-xl px-2.5 py-1.5 text-xs font-black transition-all ${
                canUndo
                  ? 'text-white bg-white/10 hover:bg-white/20 border border-white/15 active:scale-95'
                  : 'text-white/20 bg-white/5 cursor-not-allowed border border-transparent'
              }`}
            >
              ↶
            </motion.button>
            <motion.button
              whileHover={{ scale: canRedo ? 1.08 : 1 }}
              whileTap={{ scale: canRedo ? 0.9 : 1 }}
              onClick={onRedo}
              disabled={!canRedo}
              title="Redo (Key: Y)"
              className={`rounded-xl px-2.5 py-1.5 text-xs font-black transition-all ${
                canRedo
                  ? 'text-white bg-white/10 hover:bg-white/20 border border-white/15 active:scale-95'
                  : 'text-white/20 bg-white/5 cursor-not-allowed border border-transparent'
              }`}
            >
              ↷
            </motion.button>
            <motion.button
              whileHover={{ scale: 1.05 }}
              whileTap={{ scale: 0.92 }}
              onClick={onClear}
              title="Clear Canvas (Key: X)"
              className="flex items-center gap-1 rounded-xl px-3 py-1.5 text-xs font-black text-rose-300 bg-rose-500/15 hover:bg-rose-500/30 border border-rose-500/40 transition shadow-[0_0_12px_rgba(244,63,94,0.2)]"
            >
              <span>✕</span>
              <span>CLEAR</span>
            </motion.button>
          </div>
        </div>
      </div>
    </>
  );
}