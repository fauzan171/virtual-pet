import { isVoiceConfigured } from '@/lib/qwen-realtime-asr';
import { understandVoicePrompt } from '@/lib/voice-prompt-pipeline';

const MAX_AUDIO_SIZE = 2 * 1024 * 1024;
const MAX_SKETCH_SIZE = 10 * 1024 * 1024;
const MAX_BODY_SIZE = MAX_AUDIO_SIZE + MAX_SKETCH_SIZE + 128 * 1024;
const RATE_WINDOW_MS = 60_000;
const RATE_LIMIT = 20;
const requestWindows = new Map<string, { startedAt: number; count: number }>();

function withinRateLimit(req: Request): boolean {
  const key = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'local';
  const now = Date.now();
  const window = requestWindows.get(key);
  if (!window || now - window.startedAt >= RATE_WINDOW_MS) {
    requestWindows.set(key, { startedAt: now, count: 1 });
    if (requestWindows.size > 1000) {
      for (const [entryKey, entry] of requestWindows) {
        if (now - entry.startedAt >= RATE_WINDOW_MS) requestWindows.delete(entryKey);
      }
    }
    return true;
  }
  window.count++;
  return window.count <= RATE_LIMIT;
}

function requestIsSameOrigin(req: Request): boolean {
  const origin = req.headers.get('origin');
  if (!origin) return true;
  const host = req.headers.get('x-forwarded-host') ?? req.headers.get('host');
  if (!host) return false;
  try { return new URL(origin).host === host; } catch { return false; }
}

function extractPcm16Wav(buffer: Buffer): Buffer | null {
  if (buffer.length < 44 || buffer.toString('ascii', 0, 4) !== 'RIFF' || buffer.toString('ascii', 8, 12) !== 'WAVE') return null;
  let offset = 12;
  let validFormat = false;
  let audio: Buffer | null = null;
  while (offset + 8 <= buffer.length) {
    const id = buffer.toString('ascii', offset, offset + 4);
    const size = buffer.readUInt32LE(offset + 4);
    const start = offset + 8;
    const end = start + size;
    if (end > buffer.length) return null;
    if (id === 'fmt ' && size >= 16) {
      validFormat = buffer.readUInt16LE(start) === 1 &&
        buffer.readUInt16LE(start + 2) === 1 &&
        buffer.readUInt32LE(start + 4) === 16_000 &&
        buffer.readUInt16LE(start + 14) === 16;
    } else if (id === 'data') {
      audio = buffer.subarray(start, end);
    }
    offset = end + (size % 2);
  }
  return validFormat ? audio : null;
}

export async function POST(req: Request) {
  if (!requestIsSameOrigin(req)) return Response.json({ error: 'Forbidden origin' }, { status: 403 });
  if (!withinRateLimit(req)) {
    return Response.json({ error: 'Too many transcription requests' }, { status: 429, headers: { 'Retry-After': '60' } });
  }
  const contentLength = Number(req.headers.get('content-length'));
  if (Number.isFinite(contentLength) && contentLength > MAX_BODY_SIZE) {
    return Response.json({ error: 'Request too large' }, { status: 413 });
  }
  if (!isVoiceConfigured()) return Response.json({ error: 'VOICE AI NOT CONFIGURED' }, { status: 503 });
  let form: FormData;
  try { form = await req.formData(); } catch { return Response.json({ error: 'Invalid request body' }, { status: 400 }); }
  const file = form.get('audio');
  if (!(file instanceof File)) return Response.json({ error: 'Missing audio field' }, { status: 400 });
  if (file.type !== 'audio/wav' || file.size > MAX_AUDIO_SIZE) {
    return Response.json({ error: 'Audio must be WAV and at most 2 MB' }, { status: 400 });
  }
  const pcm = extractPcm16Wav(Buffer.from(await file.arrayBuffer()));
  if (!pcm) return Response.json({ error: 'Audio must be 16 kHz, 16-bit, mono PCM WAV' }, { status: 400 });
  const sketchFile = form.get('sketch');
  let sketchPng: Buffer | undefined;
  if (sketchFile instanceof File) {
    if (sketchFile.type !== 'image/png' || sketchFile.size > MAX_SKETCH_SIZE) {
      return Response.json({ error: 'Sketch must be a PNG at most 10 MB' }, { status: 400 });
    }
    sketchPng = Buffer.from(await sketchFile.arrayBuffer());
    if (sketchPng.length < 24 || sketchPng.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a') {
      return Response.json({ error: 'Invalid sketch PNG' }, { status: 400 });
    }
  }
  try {
    const result = await understandVoicePrompt(pcm, sketchPng, req.signal);
    return Response.json(result);
  } catch (error) {
    console.error('Voice prompt pipeline failed:', error);
    return Response.json({ error: 'UNABLE TO UNDERSTAND VOICE PROMPT' }, { status: 502 });
  }
}
