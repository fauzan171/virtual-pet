import type { ShapeId, ToolId } from '@/lib/types';

interface Props {
  pinching: boolean;
  tool: ToolId;
  activeShape: ShapeId | null;
  inkColor: string;
}

const GESTURES = [
  { count: 'PINCH', title: 'DRAW', detail: 'Thumb + index' },
  { count: '02', title: 'COLOR', detail: 'Index + middle' },
  { count: '03', title: 'SHAPE', detail: 'Pick a geometry' },
  { count: '04', title: 'ERASER', detail: 'Toggle pen / erase' },
  { count: '05', title: 'COMMAND', detail: 'Open selection wheel' },
] as const;

/** Always-visible stage crib sheet placed in the black rail beside the canvas. */
export default function GestureGuide({ pinching, tool, activeShape, inkColor }: Props) {
  const mode = activeShape ? activeShape.toUpperCase() : tool.toUpperCase();

  return (
    <aside className="relative z-20 hidden w-[278px] shrink-0 flex-col justify-center px-5 lg:flex">
      <div className="mb-4 flex items-center justify-between border-b border-cyan-200/15 pb-3 font-mono">
        <div>
          <p className="text-[9px] tracking-[0.32em] text-cyan-200/45">AIR CONTROL</p>
          <h2 className="mt-1 text-sm font-black tracking-[0.2em] text-white">QUICK GUIDE</h2>
        </div>
        <div
          className={`h-3 w-3 rounded-full ${pinching ? 'bg-amber-300 shadow-[0_0_18px_rgba(252,211,77,.9)]' : 'bg-cyan-300 shadow-[0_0_14px_rgba(34,211,238,.65)]'}`}
        />
      </div>

      <div className="mb-4 rounded-2xl border border-white/10 bg-white/[0.035] px-4 py-3 font-mono shadow-[inset_0_0_24px_rgba(34,211,238,.025)]">
        <div className="flex items-center justify-between">
          <span className="text-[9px] tracking-[0.28em] text-white/35">ACTIVE MODE</span>
          <span className={`text-[9px] tracking-[0.2em] ${pinching ? 'text-amber-300' : 'text-cyan-300'}`}>
            {pinching ? 'INK DOWN' : 'READY'}
          </span>
        </div>
        <div className="mt-2 flex items-center gap-2">
          <span className="h-3 w-3 rounded-full border border-white/40" style={{ backgroundColor: inkColor }} />
          <span className="text-base font-black tracking-[0.18em] text-white">{mode}</span>
        </div>
      </div>

      <div className="space-y-2">
        {GESTURES.map((gesture, index) => {
          const active = index === 0 && pinching;
          return (
            <div
              key={gesture.count}
              className={`group flex min-h-[58px] items-center gap-3 rounded-xl border px-3 py-2 font-mono transition-colors ${
                active
                  ? 'border-amber-300/70 bg-amber-300/10 shadow-[0_0_24px_rgba(252,211,77,.1)]'
                  : 'border-white/[0.07] bg-[#08111b]/70'
              }`}
            >
              <div className={`flex h-9 min-w-12 items-center justify-center rounded-lg border text-[11px] font-black tracking-wider ${
                active
                  ? 'border-amber-300/50 text-amber-200'
                  : 'border-cyan-200/20 text-cyan-200/75'
              }`}>
                {gesture.count}
              </div>
              <div className="min-w-0">
                <p className="text-[11px] font-black tracking-[0.2em] text-white">{gesture.title}</p>
                <p className="mt-0.5 truncate text-[9px] tracking-[0.08em] text-white/35">{gesture.detail}</p>
              </div>
            </div>
          );
        })}
      </div>

      <div className="mt-4 border-l-2 border-cyan-300/40 pl-3 font-mono text-[9px] leading-relaxed tracking-[0.14em] text-white/35">
        INSIDE WHEEL<br />AIM AT A NODE + PINCH
      </div>
    </aside>
  );
}
