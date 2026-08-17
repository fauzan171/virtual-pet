/**
 * Stage sound cues via WebAudio oscillators — no asset files to load.
 * Toggle with the S key. Kept deliberately subtle per the PRD.
 */

let ctx: AudioContext | null = null;
let enabled = false;

function audio(): AudioContext {
  ctx ??= new AudioContext();
  if (ctx.state === 'suspended') ctx.resume();
  return ctx;
}

function tone(freq: number, durationMs: number, type: OscillatorType, gainPeak = 0.08, sweepTo?: number) {
  if (!enabled) return;
  const a = audio();
  const osc = a.createOscillator();
  const gain = a.createGain();
  const now = a.currentTime;
  const dur = durationMs / 1000;

  osc.type = type;
  osc.frequency.setValueAtTime(freq, now);
  if (sweepTo) osc.frequency.exponentialRampToValueAtTime(sweepTo, now + dur);

  gain.gain.setValueAtTime(0, now);
  gain.gain.linearRampToValueAtTime(gainPeak, now + 0.01);
  gain.gain.exponentialRampToValueAtTime(0.0001, now + dur);

  osc.connect(gain).connect(a.destination);
  osc.start(now);
  osc.stop(now + dur + 0.02);
}

export const sound = {
  toggle(): boolean {
    enabled = !enabled;
    if (enabled) tone(880, 120, 'sine');
    return enabled;
  },

  isEnabled: () => enabled,

  /** Virtual button click */
  click() {
    tone(660, 90, 'triangle');
  },

  /** Sketch captured */
  captured() {
    tone(520, 110, 'sine');
    setTimeout(() => tone(780, 130, 'sine'), 90);
  },

  /** AI generation started */
  generateStart() {
    tone(330, 300, 'sine', 0.05, 660);
  },

  /** Successful reveal */
  reveal() {
    tone(523, 140, 'sine');
    setTimeout(() => tone(659, 140, 'sine'), 120);
    setTimeout(() => tone(784, 220, 'sine'), 240);
  },

  /** Hand tracking first activated */
  trackingOn() {
    tone(440, 100, 'sine', 0.04);
  },
};
