import type { Stroke } from './types';

/**
 * Incremental stroke rendering with quadratic Bézier smoothing and optional neon glow.
 * Draws from `from` index to the end of the stroke.
 */
export function drawStrokeSegment(
  ctx: CanvasRenderingContext2D,
  stroke: Stroke,
  from: number
): void {
  const pts = stroke.points;
  if (pts.length < 2) {
    if (pts.length === 1) {
      if (stroke.glow) {
        ctx.shadowBlur = 12;
        ctx.shadowColor = stroke.color;
      } else {
        ctx.shadowBlur = 0;
      }
      ctx.fillStyle = stroke.color;
      ctx.beginPath();
      ctx.arc(pts[0].x, pts[0].y, stroke.width / 2, 0, Math.PI * 2);
      ctx.fill();
      ctx.shadowBlur = 0;
    }
    return;
  }

  if (stroke.glow) {
    ctx.shadowBlur = 14;
    ctx.shadowColor = stroke.color;
  } else {
    ctx.shadowBlur = 0;
  }

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
    if (i === start) {
      ctx.moveTo(p0.x, p0.y);
    }
    ctx.quadraticCurveTo(p0.x, p0.y, midX, midY);
  }
  // Finish to the last point
  const last = pts[pts.length - 1];
  ctx.lineTo(last.x, last.y);
  ctx.stroke();
  ctx.shadowBlur = 0;
}


/**
 * Parametric and recognized shapes renderer.
 */
export function drawShape(
  ctx: CanvasRenderingContext2D,
  stroke: Stroke
): void {
  const pts = stroke.points;
  if (pts.length < 2) return;

  if (stroke.glow) {
    ctx.shadowBlur = 14;
    ctx.shadowColor = stroke.color;
  } else {
    ctx.shadowBlur = 0;
  }

  ctx.strokeStyle = stroke.color;
  ctx.lineWidth = stroke.width;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.beginPath();

  const a = pts[0];
  const b = pts[pts.length - 1];
  const r = Math.hypot(b.x - a.x, b.y - a.y);

  if (stroke.shape === 'circle') {
    if (pts.length > 10) {
      // Freeform recognized circle / polygon
      drawPolygon(ctx, pts, true);
    } else {
      ctx.arc(a.x, a.y, Math.max(r, 2), 0, Math.PI * 2);
    }
  } else if (stroke.shape === 'square') {
    if (pts.length >= 4) {
      drawPolygon(ctx, pts, true);
    } else {
      const half = r / Math.SQRT2;
      ctx.rect(a.x - half, a.y - half, half * 2, half * 2);
    }
  } else if (stroke.shape === 'rectangle') {
    if (pts.length >= 4) {
      drawPolygon(ctx, pts, true);
    } else {
      ctx.rect(Math.min(a.x, b.x), Math.min(a.y, b.y), Math.abs(b.x - a.x), Math.abs(b.y - a.y));
    }
  } else if (stroke.shape === 'triangle') {
    if (pts.length >= 3) {
      drawPolygon(ctx, pts, true);
    } else {
      ctx.moveTo(a.x, a.y - r);
      ctx.lineTo(a.x - r, a.y);
      ctx.lineTo(a.x + r, a.y);
      ctx.closePath();
    }
  } else if (stroke.shape === 'star') {
    if (pts.length >= 5) {
      drawPolygon(ctx, pts, true);
    } else {
      const outerR = Math.max(r, 10);
      const innerR = outerR * 0.45;
      for (let i = 0; i < 10; i++) {
        const radius = i % 2 === 0 ? outerR : innerR;
        const angle = (i * Math.PI) / 5 - Math.PI / 2;
        const px = a.x + radius * Math.cos(angle);
        const py = a.y + radius * Math.sin(angle);
        if (i === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      }
      ctx.closePath();
    }
  } else if (stroke.shape === 'heart') {
    drawPolygon(ctx, pts, true);
  } else if (stroke.shape === 'line') {
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
  } else if (stroke.shape === 'arrow') {
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    // Draw arrowhead at end
    const angle = Math.atan2(b.y - a.y, b.x - a.x);
    const headLen = Math.min(24, r * 0.3);
    ctx.lineTo(
      b.x - headLen * Math.cos(angle - Math.PI / 6),
      b.y - headLen * Math.sin(angle - Math.PI / 6)
    );
    ctx.moveTo(b.x, b.y);
    ctx.lineTo(
      b.x - headLen * Math.cos(angle + Math.PI / 6),
      b.y - headLen * Math.sin(angle + Math.PI / 6)
    );
  } else {
    drawStrokeSegment(ctx, stroke, 1);
    ctx.shadowBlur = 0;
    return;
  }
  ctx.stroke();
  ctx.shadowBlur = 0;
}

function drawPolygon(ctx: CanvasRenderingContext2D, pts: { x: number; y: number }[], close: boolean) {
  if (pts.length === 0) return;
  ctx.moveTo(pts[0].x, pts[0].y);
  for (let i = 1; i < pts.length; i++) {
    ctx.lineTo(pts[i].x, pts[i].y);
  }
  if (close) ctx.closePath();
}

/** Full redraw — clear canvas, white background, all strokes. */
export function redrawAll(
  ctx: CanvasRenderingContext2D,
  strokes: Stroke[],
  w: number,
  h: number
): void {
  ctx.shadowBlur = 0;
  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, w, h);
  for (const stroke of strokes) {
    if (stroke.shape) drawShape(ctx, stroke);
    else drawStrokeSegment(ctx, stroke, 1);
  }
  ctx.shadowBlur = 0;
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


