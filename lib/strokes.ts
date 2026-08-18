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

/**
 * Parametric shapes sized by the DISTANCE from the anchor (first pinch
 * point) to the cursor — a single scalar, so a shaking hand wobbles the
 * outline uniformly instead of warping width and height independently.
 * Aspect-locked shapes stay square/circular no matter the drag path.
 */
export function drawShape(
  ctx: CanvasRenderingContext2D,
  stroke: Stroke
): void {
  const pts = stroke.points;
  if (pts.length < 2) return;
  const a = pts[0];
  const b = pts[pts.length - 1];
  const r = Math.hypot(b.x - a.x, b.y - a.y);
  if (r < 2) return; // too small — nothing meaningful yet

  ctx.strokeStyle = stroke.color;
  ctx.lineWidth = stroke.width;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.beginPath();

  if (stroke.shape === 'circle') {
    ctx.arc(a.x, a.y, r, 0, Math.PI * 2);
  } else if (stroke.shape === 'square') {
    const half = r / Math.SQRT2; // corner-to-corner drag → side from distance
    ctx.rect(a.x - half, a.y - half, half * 2, half * 2);
  } else if (stroke.shape === 'triangle') {
    // Isosceles, apex up, base at anchor level, height = r
    ctx.moveTo(a.x, a.y - r);
    ctx.lineTo(a.x - r, a.y);
    ctx.lineTo(a.x + r, a.y);
    ctx.closePath();
  } else if (stroke.shape === 'line') {
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
  } else {
    drawStrokeSegment(ctx, stroke, 1);
    return;
  }
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
    if (stroke.shape) drawShape(ctx, stroke);
    else drawStrokeSegment(ctx, stroke, 1);
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
