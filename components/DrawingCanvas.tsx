'use client';

import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
} from 'react';
import { redrawAll, exportPng } from '@/lib/strokes';
import type { Stroke } from '@/lib/types';

export interface DrawingCanvasHandle {
  getCtx(): CanvasRenderingContext2D | null;
  getCanvas(): HTMLCanvasElement | null;
  redraw(strokes: Stroke[]): void;
  clear(): void;
  exportPng(): Promise<Blob>;
  /** Returns [w, h] in CSS pixels. */
  size(): [number, number];
}

const DrawingCanvas = forwardRef<DrawingCanvasHandle>(function DrawingCanvas(
  _,
  ref
) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const ctxRef = useRef<CanvasRenderingContext2D | null>(null);
  const strokesRef = useRef<Stroke[]>([]);

  useEffect(() => {
    const canvas = canvasRef.current!;
    const resize = () => {
      const rect = canvas.parentElement!.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      canvas.width = rect.width * dpr;
      canvas.height = rect.height * dpr;
      canvas.style.width = `${rect.width}px`;
      canvas.style.height = `${rect.height}px`;
      const ctx = canvas.getContext('2d')!;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctxRef.current = ctx;
      redrawAll(ctx, strokesRef.current, rect.width, rect.height);
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(canvas.parentElement!);
    return () => ro.disconnect();
  }, []);

  useImperativeHandle(ref, () => ({
    getCtx: () => ctxRef.current,
    getCanvas: () => canvasRef.current,
    redraw(strokes) {
      strokesRef.current = strokes;
      const canvas = canvasRef.current;
      const ctx = ctxRef.current;
      if (canvas && ctx) {
        redrawAll(ctx, strokes, canvas.clientWidth, canvas.clientHeight);
      }
    },
    clear() {
      strokesRef.current = [];
      const ctx = ctxRef.current;
      const canvas = canvasRef.current;
      if (ctx && canvas) {
        redrawAll(ctx, [], canvas.clientWidth, canvas.clientHeight);
      }
    },
    async exportPng() {
      return exportPng(canvasRef.current!);
    },
    size: () => [canvasRef.current?.clientWidth ?? 0, canvasRef.current?.clientHeight ?? 0],
  }));

  return (
    <div className="absolute inset-0 z-10 flex items-center justify-center p-6">
      <div className="relative h-full w-full max-w-[1200px] rounded-2xl shadow-2xl overflow-hidden">
        <canvas ref={canvasRef} className="block h-full w-full" />
      </div>
    </div>
  );
});

export default DrawingCanvas;
