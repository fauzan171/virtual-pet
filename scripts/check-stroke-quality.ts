import { renderLiveStroke } from '../lib/strokes.ts';
import type { Point, Stroke } from '../lib/types.ts';

function assert(cond: boolean, msg: string): void {
  if (!cond) {
    console.error('FAIL:', msg);
    process.exitCode = 1;
  }
}

let clears = 0;
let fills = 0;
let strokeCalls = 0;
const freehandControlYs: number[] = [];
const ctx = {
  clearRect: () => { clears++; },
  fillRect: () => { fills++; },
  beginPath: () => {},
  moveTo: () => {},
  quadraticCurveTo: (_cpx: number, cpy: number) => { freehandControlYs.push(cpy); },
  lineTo: () => {},
  stroke: () => { strokeCalls++; },
  arc: () => {},
  rect: () => {},
  closePath: () => {},
  set fillStyle(_value: string) {},
  set strokeStyle(_value: string) {},
  set lineWidth(_value: number) {},
  set lineCap(_value: CanvasLineCap) {},
  set lineJoin(_value: CanvasLineJoin) {},
} as unknown as CanvasRenderingContext2D;

const points: Point[] = Array.from({ length: 20 }, (_, i) => ({
  x: i * 8,
  y: 120 + Math.sin(i / 3) * 45,
}));
const stroke: Stroke = { points: [], width: 5, color: '#111827' };
for (const point of points) {
  stroke.points.push(point);
  if (stroke.points.length > 1) {
    const strokesBeforeFrame = strokeCalls;
    const fillsBeforeFrame = fills;
    renderLiveStroke(ctx, stroke, 1200, 720);
    assert(
      strokeCalls - strokesBeforeFrame === 1,
      `live frame must draw only the active stroke; drew ${strokeCalls - strokesBeforeFrame}`
    );
    assert(fills === fillsBeforeFrame, 'live overlay must stay transparent');
  }
}

assert(
  clears === points.length - 1,
  `live stroke must replace the previous partial path every frame; cleared ${clears}/${points.length - 1}`
);
const freehandBend = Math.max(...freehandControlYs) - Math.min(...freehandControlYs);
assert(
  freehandBend > 60,
  `freehand must preserve the hand-drawn bend instead of auto-straightening (${freehandBend.toFixed(1)}px)`
);

if (!process.exitCode) console.log('all stroke quality checks pass');
