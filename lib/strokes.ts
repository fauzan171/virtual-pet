import type { Stroke } from './types';

/**
 * Incremental stroke rendering with quadratic Bézier smoothing.
 * Draws from `from` index to the end of the stroke — called each frame
 * during live drawing to avoid full redraws.
 */
export function drawStrokeSegment(
  ctx: CanvasRenderingContext2D,
  stroke: Stroke,
  from: number
): void {
  const pts = stroke.points;
  if (pts.length < 2) return;

  ctx.strokeStyle = stroke.color;
  ctx.lineWidth = stroke.width;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.beginPath();

  const start = Math.max(1, from);
  for (let i = start; i < pts.length; i++) {
    const p0 = pts[i - 1];
    const p1 = pts[i];
    const midX = (p0.x + p1.x) / 2;
    const midY = (p0.y + p1.y) / 2;
    if (i === start) ctx.moveTo(p0.x, p0.y);
    ctx.quadraticCurveTo(p0.x, p0.y, midX, midY);
  }
  // Finish to the last point
  const last = pts[pts.length - 1];
  ctx.lineTo(last.x, last.y);
  ctx.stroke();
}

/** Full redraw — clear canvas, white background, all strokes. */
export function redrawAll(
  ctx: CanvasRenderingContext2D,
  strokes: Stroke[],
  w: number,
  h: number
): void {
  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, w, h);
  for (const stroke of strokes) {
    drawStrokeSegment(ctx, stroke, 1);
  }
}

/** Export canvas as PNG blob with white background baked in. */
export function exportPng(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error('toBlob failed'))),
      'image/png'
    );
  });
}
