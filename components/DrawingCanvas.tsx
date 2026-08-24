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
  spawnParticles(x: number, y: number, color: string): void;
  size(): [number, number];
  rect(): DOMRect;
}

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  size: number;
  color: string;
  alpha: number;
  decay: number;
  active: boolean;
}

const MAX_PARTICLES = 120;

const DrawingCanvas = forwardRef<DrawingCanvasHandle>(function DrawingCanvas(
  _,
  ref
) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const particleCanvasRef = useRef<HTMLCanvasElement>(null);
  const ctxRef = useRef<CanvasRenderingContext2D | null>(null);
  const particleCtxRef = useRef<CanvasRenderingContext2D | null>(null);
  const strokesRef = useRef<Stroke[]>([]);
  
  // Cache dimensi DOM untuk mencegah Forced Layout Reflow 120 FPS
  const cachedSizeRef = useRef<[number, number]>([0, 0]);
  const cachedRectRef = useRef<DOMRect>(new DOMRect());

  // Pre-allocated High-Performance Particle Pool
  const particlePoolRef = useRef<Particle[]>(
    Array.from({ length: MAX_PARTICLES }, () => ({
      x: 0,
      y: 0,
      vx: 0,
      vy: 0,
      size: 0,
      color: '#00f0ff',
      alpha: 0,
      decay: 0.04,
      active: false,
    }))
  );
  const poolIndexRef = useRef(0);
  const animFrameRef = useRef<number>(0);

  useEffect(() => {
    const canvas = canvasRef.current;
    const pCanvas = particleCanvasRef.current;
    if (!canvas || !pCanvas) return;

    const updateCachedDimensions = () => {
      const parent = canvas.parentElement;
      if (!parent) return;
      const rect = parent.getBoundingClientRect();
      cachedRectRef.current = rect;
      cachedSizeRef.current = [rect.width, rect.height];
      return { rect };
    };

    const resize = () => {
      const dims = updateCachedDimensions();
      if (!dims) return;
      const { rect } = dims;
      // Batasi DPR maksimal 2x untuk menjaga performa rendering di monitor 4K/Retina
      const dpr = Math.min(window.devicePixelRatio || 1, 2);

      canvas.width = rect.width * dpr;
      canvas.height = rect.height * dpr;
      canvas.style.width = `${rect.width}px`;
      canvas.style.height = `${rect.height}px`;

      pCanvas.width = rect.width * dpr;
      pCanvas.height = rect.height * dpr;
      pCanvas.style.width = `${rect.width}px`;
      pCanvas.style.height = `${rect.height}px`;

      const ctx = canvas.getContext('2d', { alpha: true });
      if (ctx) {
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = 'high';
        ctxRef.current = ctx;
      }

      const pCtx = pCanvas.getContext('2d', { alpha: true });
      if (pCtx) {
        pCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
        particleCtxRef.current = pCtx;
      }

      if (ctx) {
        redrawAll(ctx, strokesRef.current, rect.width, rect.height);
      }
    };

    resize();
    const ro = new ResizeObserver(() => {
      resize();
    });
    if (canvas.parentElement) {
      ro.observe(canvas.parentElement);
    }

    // Engine Partikel: Memanfaatkan Additive Blending (lighter) pengganti shadowBlur
    const renderParticles = () => {
      const pCtx = particleCtxRef.current;
      const [w, h] = cachedSizeRef.current;

      if (pCtx && w > 0 && h > 0) {
        pCtx.clearRect(0, 0, w, h);

        const pool = particlePoolRef.current;

        pCtx.save();
        pCtx.globalCompositeOperation = 'lighter'; // Pendaran neon ringan tanpa beban GPU

        for (let i = 0; i < pool.length; i++) {
          const p = pool[i];
          if (!p.active) continue;

          p.x += p.vx;
          p.y += p.vy;
          p.alpha -= p.decay;
          p.size *= 0.95;

          if (p.alpha <= 0 || p.size <= 0.2) {
            p.active = false;
            continue;
          }

          pCtx.globalAlpha = Math.max(0, p.alpha);
          pCtx.fillStyle = p.color;

          pCtx.beginPath();
          pCtx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
          pCtx.fill();
        }

        pCtx.restore();
      }

      animFrameRef.current = requestAnimationFrame(renderParticles);
    };

    animFrameRef.current = requestAnimationFrame(renderParticles);

    return () => {
      ro.disconnect();
      cancelAnimationFrame(animFrameRef.current);
    };
  }, []);

  useImperativeHandle(ref, () => ({
    getCtx: () => ctxRef.current,
    getCanvas: () => canvasRef.current,
    redraw(strokes) {
      strokesRef.current = strokes;
      const canvas = canvasRef.current;
      const ctx = ctxRef.current;
      if (canvas && ctx) {
        redrawAll(ctx, strokes, cachedSizeRef.current[0], cachedSizeRef.current[1]);
      }
    },
    clear() {
      strokesRef.current = [];
      const pool = particlePoolRef.current;
      for (let i = 0; i < pool.length; i++) pool[i].active = false;
      const ctx = ctxRef.current;
      const canvas = canvasRef.current;
      if (ctx && canvas) {
        redrawAll(ctx, [], cachedSizeRef.current[0], cachedSizeRef.current[1]);
      }
    },
    exportPng() {
      return exportPng(canvasRef.current!);
    },
    spawnParticles(x: number, y: number, color: string) {
      const count = 3;
      const pool = particlePoolRef.current;
      const effColor = color === '#1a1a2e' || color === '#ffffff' ? '#00f0ff' : color;

      for (let i = 0; i < count; i++) {
        const idx = (poolIndexRef.current + i) % MAX_PARTICLES;
        const p = pool[idx];
        const angle = Math.random() * Math.PI * 2;
        const speed = 0.8 + Math.random() * 2.2;

        p.x = x + (Math.random() - 0.5) * 8;
        p.y = y + (Math.random() - 0.5) * 8;
        p.vx = Math.cos(angle) * speed;
        p.vy = Math.sin(angle) * speed;
        p.size = 2.5 + Math.random() * 4;
        p.color = effColor;
        p.alpha = 1.0;
        p.decay = 0.03 + Math.random() * 0.03;
        p.active = true;
      }
      poolIndexRef.current = (poolIndexRef.current + count) % MAX_PARTICLES;
    },
    size: () => cachedSizeRef.current,
    rect: () => cachedRectRef.current,
  }));

  return (
    <div className="absolute inset-0 z-10 flex items-center justify-center p-6">
      <div className="relative h-full w-full max-w-[1240px] rounded-3xl shadow-[0_20px_60px_-15px_rgba(0,0,0,0.7),0_0_30px_rgba(0,240,255,0.12)] border border-white/20 overflow-hidden bg-white">
        <canvas ref={canvasRef} className="block h-full w-full" />
        <canvas ref={particleCanvasRef} className="pointer-events-none absolute inset-0 block h-full w-full" />
      </div>
    </div>
  );
});

export default DrawingCanvas;