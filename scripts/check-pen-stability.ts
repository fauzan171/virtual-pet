/** Deterministic camera-jitter trace for the air-pen signal path. */
import { OneEuroFilter } from '../lib/one-euro.ts';
import {
  ONE_EURO_MIN_CUTOFF,
  ONE_EURO_BETA,
  ONE_EURO_D_CUTOFF,
} from '../lib/constants.ts';

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(`FAIL: ${message}`);
}

function filter() {
  return new OneEuroFilter(ONE_EURO_MIN_CUTOFF, ONE_EURO_BETA, ONE_EURO_D_CUTOFF);
}

// MediaPipe jitter after calibration/mapping is commonly several screen px,
// substantially larger than the old idealized ±0.8 px test trace.
{
  const f = filter();
  const values: number[] = [];
  let timestamp = 0;
  for (let i = 0; i < 300; i++) {
    timestamp += 33;
    const raw = 500 + Math.sin(i * 12.9898) * 6 + Math.sin(i * 2.17) * 2.1;
    const value = f.filter(raw, timestamp);
    if (i > 30) values.push(value);
  }
  const spread = Math.max(...values) - Math.min(...values);
  let maxStep = 0;
  for (let i = 1; i < values.length; i++) {
    maxStep = Math.max(maxStep, Math.abs(values[i] - values[i - 1]));
  }
  assert(spread < 7, `resting pen spread ${spread.toFixed(2)}px must stay below 7px`);
  assert(maxStep < 2.2, `resting pen step ${maxStep.toFixed(2)}px must stay below 2.2px`);
  console.log(`rest lock: ${spread.toFixed(2)}px spread, ${maxStep.toFixed(2)}px max step`);
}

// A deliberate fast sweep must still feel attached to the hand.
{
  const f = filter();
  let timestamp = 0;
  let maxLag = 0;
  for (let i = 0; i <= 15; i++) {
    timestamp += 33;
    const raw = 500 + (500 * i) / 15;
    const value = f.filter(raw, timestamp);
    if (i > 5) maxLag = Math.max(maxLag, Math.abs(raw - value));
  }
  assert(maxLag < 12, `fast-stroke lag ${maxLag.toFixed(2)}px must stay below 12px`);
  console.log(`fast response: ${maxLag.toFixed(2)}px max lag`);
}

// Slow intentional motion must not be mistaken for a stationary hand.
{
  const f = filter();
  let timestamp = 0;
  let value = 500;
  for (let i = 0; i <= 100; i++) {
    timestamp += 33;
    value = f.filter(500 + i, timestamp);
  }
  const lag = 600 - value;
  assert(lag < 5, `slow-stroke lag ${lag.toFixed(2)}px must stay below 5px`);
  console.log(`slow precision: ${lag.toFixed(2)}px endpoint lag`);
}

console.log('all pen stability checks pass');
