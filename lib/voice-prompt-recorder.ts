/**
 * Browser microphone capture for short spoken image prompts.
 *
 * Audio is converted locally to 16 kHz / 16-bit / mono WAV. Recording stops
 * automatically after speech followed by silence, so the presenter only needs
 * to press M once and speak.
 */

const TARGET_SAMPLE_RATE = 16_000;
const MAX_RECORDING_MS = 15_000;
const NO_SPEECH_TIMEOUT_MS = 7_000;
const SILENCE_AFTER_SPEECH_MS = 1_200;
const SPEECH_RMS_THRESHOLD = 0.018;

export type VoiceCaptureStatus = 'listening' | 'processing';

export interface CaptureVoiceOptions {
  signal?: AbortSignal;
  onStatus?: (status: VoiceCaptureStatus) => void;
}

function downsample(input: Float32Array, sourceRate: number): Float32Array {
  if (sourceRate === TARGET_SAMPLE_RATE) return input;
  const ratio = sourceRate / TARGET_SAMPLE_RATE;
  const output = new Float32Array(Math.floor(input.length / ratio));
  for (let i = 0; i < output.length; i++) {
    const start = Math.floor(i * ratio);
    const end = Math.min(input.length, Math.floor((i + 1) * ratio));
    let sum = 0;
    for (let j = start; j < end; j++) sum += input[j];
    output[i] = sum / Math.max(1, end - start);
  }
  return output;
}

function encodeWav(samples: Float32Array): Blob {
  const buffer = new ArrayBuffer(44 + samples.length * 2);
  const view = new DataView(buffer);
  const writeAscii = (offset: number, value: string) => {
    for (let i = 0; i < value.length; i++) view.setUint8(offset + i, value.charCodeAt(i));
  };
  writeAscii(0, 'RIFF');
  view.setUint32(4, 36 + samples.length * 2, true);
  writeAscii(8, 'WAVE');
  writeAscii(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, TARGET_SAMPLE_RATE, true);
  view.setUint32(28, TARGET_SAMPLE_RATE * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeAscii(36, 'data');
  view.setUint32(40, samples.length * 2, true);
  for (let i = 0; i < samples.length; i++) {
    const sample = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(44 + i * 2, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true);
  }
  return new Blob([buffer], { type: 'audio/wav' });
}

export async function captureVoicePrompt(options: CaptureVoiceOptions = {}): Promise<Blob> {
  if (!navigator.mediaDevices?.getUserMedia) throw new Error('Microphone unavailable');
  options.signal?.throwIfAborted();

  const stream = await navigator.mediaDevices.getUserMedia({
    audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true },
    video: false,
  });
  const context = new AudioContext();
  const source = context.createMediaStreamSource(stream);
  // ScriptProcessor is intentionally used here for broad stage-browser support.
  // It never leaves the browser and runs for at most 15 seconds.
  const processor = context.createScriptProcessor(4096, 1, 1);
  const sink = context.createGain();
  sink.gain.value = 0;
  const chunks: Float32Array[] = [];
  const startedAt = performance.now();
  let speechStarted = false;
  let lastSpeechAt = startedAt;
  let settled = false;

  source.connect(processor);
  processor.connect(sink);
  sink.connect(context.destination);
  await context.resume();
  options.onStatus?.('listening');

  return new Promise<Blob>((resolve, reject) => {
    const cleanup = () => {
      processor.disconnect();
      source.disconnect();
      sink.disconnect();
      stream.getTracks().forEach((track) => track.stop());
      void context.close();
      options.signal?.removeEventListener('abort', onAbort);
    };
    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      cleanup();
      if (error) {
        reject(error);
        return;
      }
      options.onStatus?.('processing');
      const total = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
      const merged = new Float32Array(total);
      let offset = 0;
      for (const chunk of chunks) {
        merged.set(chunk, offset);
        offset += chunk.length;
      }
      resolve(encodeWav(downsample(merged, context.sampleRate)));
    };
    const onAbort = () => finish(new DOMException('Aborted', 'AbortError'));
    options.signal?.addEventListener('abort', onAbort, { once: true });

    processor.onaudioprocess = (event) => {
      const samples = new Float32Array(event.inputBuffer.getChannelData(0));
      chunks.push(samples);
      let energy = 0;
      for (const sample of samples) energy += sample * sample;
      const rms = Math.sqrt(energy / samples.length);
      const now = performance.now();
      if (rms >= SPEECH_RMS_THRESHOLD) {
        speechStarted = true;
        lastSpeechAt = now;
      }
      if (speechStarted && now - lastSpeechAt >= SILENCE_AFTER_SPEECH_MS) finish();
      else if (!speechStarted && now - startedAt >= NO_SPEECH_TIMEOUT_MS) finish(new Error('No speech detected'));
      else if (now - startedAt >= MAX_RECORDING_MS) finish();
    };
  });
}
