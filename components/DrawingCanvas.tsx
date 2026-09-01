'use client';

import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
} from 'react';
import { drawStrokeSegment, redrawAll, renderLiveStroke, exportPng } from '@/lib/strokes';
import type { Stroke } from '@/lib/types';

export interface DrawingCanvasHandle {
  getCtx(): CanvasRenderingContext2D | null;
  getCanvas(): HTMLCanvasElement | null;
  redraw(strokes: Stroke[]): void;
  renderLive(stroke: Stroke): void;
  clear(): void;
  exportPng(): Promise<Blob>;
  /** Returns [w, h] in CSS pixels. */
  size(): [number, number];
  /** Canvas position in viewport coordinates. */
  rect(): DOMRect;
}

interface DrawingCanvasProps {
  onResize?(scaleX: number, scaleY: number): void;
}

const DrawingCanvas = forwardRef<DrawingCanvasHandle, DrawingCanvasProps>(function DrawingCanvas(
  { onResize },
  ref
) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const liveCanvasRef = useRef<HTMLCanvasElement>(null);
  const ctxRef = useRef<CanvasRenderingContext2D | null>(null);
  const liveCtxRef = useRef<CanvasRenderingContext2D | null>(null);
  const strokesRef = useRef<Stroke[]>([]);
  const liveStrokeRef = useRef<Stroke | null>(null);
  const liveRenderedPointCountRef = useRef(0);
  const sizeRef = useRef({ width: 0, height: 0 });

  useEffect(() => {
    const canvas = canvasRef.current!;
    const liveCanvas = liveCanvasRef.current!;
    const resize = () => {
      const rect = canvas.parentElement!.getBoundingClientRect();
      const previous = sizeRef.current;
      if (
        previous.width > 0 &&
        previous.height > 0 &&
        (previous.width !== rect.width || previous.height !== rect.height)
      ) {
        onResize?.(rect.width / previous.width, rect.height / previous.height);
      }
      sizeRef.current = { width: rect.width, height: rect.height };
      const dpr = window.devicePixelRatio || 1;
      for (const layer of [canvas, liveCanvas]) {
        layer.width = rect.width * dpr;
        layer.height = rect.height * dpr;
        layer.style.width = `${rect.width}px`;
        layer.style.height = `${rect.height}px`;
      }
      const ctx = canvas.getContext('2d')!;
      const liveCtx = liveCanvas.getContext('2d')!;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      liveCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctxRef.current = ctx;
      liveCtxRef.current = liveCtx;
      redrawAll(ctx, strokesRef.current, rect.width, rect.height);
      if (liveStrokeRef.current) {
        renderLiveStroke(liveCtx, liveStrokeRef.current, rect.width, rect.height);
      } else {
        liveCtx.clearRect(0, 0, rect.width, rect.height);
      }
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(canvas.parentElement!);
    return () => ro.disconnect();
  }, [onResize]);

  useImperativeHandle(ref, () => ({
    getCtx: () => ctxRef.current,
    getCanvas: () => canvasRef.current,
    redraw(strokes) {
      strokesRef.current = strokes;
      liveStrokeRef.current = null;
      liveRenderedPointCountRef.current = 0;
      const canvas = canvasRef.current;
      const ctx = ctxRef.current;
      const liveCanvas = liveCanvasRef.current;
      const liveCtx = liveCtxRef.current;
      if (canvas && ctx) {
        redrawAll(ctx, strokes, canvas.clientWidth, canvas.clientHeight);
      }
      if (liveCanvas && liveCtx) {
        liveCtx.clearRect(0, 0, liveCanvas.clientWidth, liveCanvas.clientHeight);
      }
    },
    renderLive(stroke) {
      const canvas = liveCanvasRef.current;
      const ctx = liveCtxRef.current;
      if (!canvas || !ctx) return;

      const isNewStroke = liveStrokeRef.current !== stroke;
      if (isNewStroke) {
        liveStrokeRef.current = stroke;
        liveRenderedPointCountRef.current = 0;
        ctx.clearRect(0, 0, canvas.clientWidth, canvas.clientHeight);
      }

      if (stroke.shape) {
        renderLiveStroke(ctx, stroke, canvas.clientWidth, canvas.clientHeight);
        liveRenderedPointCountRef.current = stroke.points.length;
        return;
      }

      const pointCount = stroke.points.length;
      if (pointCount < 2) return;

      if (liveRenderedPointCountRef.current <= 0) {
        renderLiveStroke(ctx, stroke, canvas.clientWidth, canvas.clientHeight);
      } else if (pointCount > liveRenderedPointCountRef.current) {
        drawStrokeSegment(ctx, stroke, liveRenderedPointCountRef.current);
      }
      liveRenderedPointCountRef.current = pointCount;
    },
    clear() {
      strokesRef.current = [];
      liveStrokeRef.current = null;
      liveRenderedPointCountRef.current = 0;
      const ctx = ctxRef.current;
      const canvas = canvasRef.current;
      const liveCtx = liveCtxRef.current;
      const liveCanvas = liveCanvasRef.current;
      if (ctx && canvas) {
        redrawAll(ctx, [], canvas.clientWidth, canvas.clientHeight);
      }
      if (liveCtx && liveCanvas) {
        liveCtx.clearRect(0, 0, liveCanvas.clientWidth, liveCanvas.clientHeight);
      }
    },
    async exportPng() {
      return exportPng(canvasRef.current!);
    },
    size: () => [canvasRef.current?.clientWidth ?? 0, canvasRef.current?.clientHeight ?? 0],
    rect: () => canvasRef.current?.getBoundingClientRect() ?? new DOMRect(),
  }));

  return (
    <div className="relative z-10 flex min-w-0 flex-1 items-center justify-center p-6">
      <div className="relative h-full w-full max-w-[1200px] overflow-hidden rounded-2xl bg-white shadow-2xl">
        <canvas ref={canvasRef} className="absolute inset-0 block h-full w-full" />
        <canvas ref={liveCanvasRef} className="pointer-events-none absolute inset-0 block h-full w-full" />
      </div>
    </div>
  );
});

export default DrawingCanvas;
