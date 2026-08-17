/**
 * Minimal WebAudio sound cues — oscillator based, zero assets to load.
 * Stage crew toggles via the S key.
 */

let ctx: AudioContext | null = null;
let enabled = false;

function beep(freq: number, durationMs: number, type: OscillatorType, gain = 0.08) {
  if (!enabled) return;
  ctx ??= new AudioContext();
  const osc = ctx.createOscillator();
  const g = ctx.createGain();
  osc.type = type;
  osc.frequency.value = freq;
  g.gain.setValueAtTime(gain, ctx.currentTime);
  g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + durationMs / 1000);
  osc.connect(g).connect(ctx.destination);
  osc.start();
  osc.stop(ctx.currentTime + durationMs / 1000);
}

export const sound = {
  toggle(): boolean {
    enabled = !enabled;
    if (enabled) beep(660, 120, 'sine');
    return enabled;
  },
  click: () => beep(520, 90, 'sine'),
  captured: () => beep(880, 200, 'sine'),
  reveal: () => {
    beep(440, 300, 'triangle');
    setTimeout(() => beep(660, 300, 'triangle'), 150);
    setTimeout(() => beep(880, 400, 'triangle'), 300);
  },
};
