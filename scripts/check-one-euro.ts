/**
 * Self-check for the One-Euro cursor filter. Run with:
 *   npm run check:one-euro
 *
 * Verifies the properties the stage demo depends on:
 *   1. Still hand → cursor stays put (jitter reduced >55%, rest step < 0.5px)
 *   2. Fast sweep → cursor follows the hand with small lag (< 30px)
 *   3. Reset → first sample after hand re-acquire is not interpolated
 */
import { OneEuroFilter } from '../lib/one-euro.ts';
import {
  ONE_EURO_MIN_CUTOFF as MIN_CUTOFF,
  ONE_EURO_BETA as BETA,
  ONE_EURO_D_CUTOFF as D_CUTOFF,
} from '../lib/constants.ts';

function assert(cond: boolean, msg: string): void {
  if (!cond) {
    console.error('FAIL:', msg);
    process.exit(1);
  }
}

// 1. Still hand: realistic MediaPipe jitter (±0.8px) at 30fps
{
  const f = new OneEuroFilter(MIN_CUTOFF, BETA, D_CUTOFF);
  let t = 0;
  let inVar = 0;
  let outVar = 0;
  const out: number[] = [];
  const noise = (i: number) => Math.sin(i * 12.9898) * 0.8;
  for (let i = 0; i < 300; i++) {
    t += 33;
    const raw = 500 + noise(i);
    const v = f.filter(raw, t);
    if (i > 30) {
      inVar += noise(i) ** 2;
      outVar += (v - 500) ** 2;
      out.push(v);
    }
  }
  assert(outVar < inVar * 0.45, `still hand jitter ratio ${(outVar / inVar).toFixed(3)} >= 0.45`);
  let maxStep = 0;
  for (let i = 1; i < out.length; i++) maxStep = Math.max(maxStep, Math.abs(out[i] - out[i - 1]));
  assert(maxStep < 0.5, `still hand rest step ${maxStep.toFixed(3)}px >= 0.5px`);
  console.log('still hand: jitter ratio', (outVar / inVar).toFixed(3), '| max rest step', maxStep.toFixed(3), 'px');
}

// 2. Fast sweep: ramp 500→1000 px over 0.5s
{
  const f = new OneEuroFilter(MIN_CUTOFF, BETA, D_CUTOFF);
  let t = 0;
  let lag = 0;
  for (let i = 0; i <= 15; i++) {
    t += 33;
    const raw = 500 + (500 * i) / 15;
    const v = f.filter(raw, t);
    if (i > 5) lag = Math.max(lag, Math.abs(raw - v));
  }
  assert(lag < 30, `fast sweep lag ${lag.toFixed(1)}px >= 30px`);
  console.log('fast sweep: max lag', lag.toFixed(1), 'px');
}

// 3. Reset: first sample after reset passes through untouched
{
  const f = new OneEuroFilter(MIN_CUTOFF, BETA, D_CUTOFF);
  f.filter(500, 0);
  f.filter(520, 33);
  f.reset();
  assert(f.filter(999, 66) === 999, 'reset: first sample after reset must equal raw input');
  console.log('reset: first sample passes through untouched');
}

console.log('all one-euro checks pass');
