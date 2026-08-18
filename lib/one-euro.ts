/**
 * One-Euro Filter (Casiez, Roussel, Vogel — CHI 2012).
 * De-facto standard for noisy pointer tracking (used across air-drawing
 * repos on GitHub): velocity-adaptive low-pass. Slow/still hand gets a low
 * cutoff (heavy smoothing, kills jitter); fast sweeps get a high cutoff
 * (low lag, straight lines stay straight). Removes the fixed-cutoff
 * tradeoff entirely — no dead zone needed.
 *
 * Params (pixel-space, from real MediaPipe drawing projects):
 *   mincutoff 1.0–1.4, beta 0.01–0.02, dcutoff 1.0
 */

class LowPass {
  private y = 0;
  private init = false;

  filter(value: number, alpha: number): number {
    if (!this.init) {
      this.init = true;
      this.y = value;
      return value;
    }
    this.y = alpha * value + (1 - alpha) * this.y;
    return this.y;
  }

  last(): number {
    return this.y;
  }

  hasValue(): boolean {
    return this.init;
  }

  reset(): void {
    this.init = false;
  }
}

export class OneEuroFilter {
  private x = new LowPass();
  private dx = new LowPass();
  private lastTime: number | null = null;
  // ponytail: explicit fields, not constructor parameter properties —
  // Node's strip-types mode (used by scripts/check-one-euro.ts) rejects them.
  private mincutoff: number;
  private beta: number;
  private dcutoff: number;

  constructor(mincutoff = 1.0, beta = 0.012, dcutoff = 1.0) {
    this.mincutoff = mincutoff;
    this.beta = beta;
    this.dcutoff = dcutoff;
  }

  /** @param value raw signal, @param timestampMs monotonic ms clock */
  filter(value: number, timestampMs: number): number {
    const prevTime = this.lastTime;
    const dt = prevTime === null ? 1 / 120 : Math.max((timestampMs - prevTime) / 1000, 1e-4);
    this.lastTime = timestampMs;

    const alpha = (cutoff: number) => {
      const tau = 1 / (2 * Math.PI * cutoff);
      return 1 / (1 + tau / dt);
    };

    // Derivative of the signal, itself low-passed (dcutoff)
    const dValue = this.x.hasValue() ? (value - this.x.last()) / dt : 0;
    const dSmoothed = this.dx.filter(dValue, alpha(this.dcutoff));

    // Cutoff grows with speed — beta scales it, mincutoff is the floor
    const cutoff = this.mincutoff + this.beta * Math.abs(dSmoothed);
    return this.x.filter(value, alpha(cutoff));
  }

  reset(): void {
    this.x.reset();
    this.dx.reset();
    this.lastTime = null;
  }
}
