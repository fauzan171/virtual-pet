import { runAgent } from '@/lib/agent';
import { isConfigured } from '@/lib/qwen-provider';
import { sanitizeSpokenPrompt } from '@/lib/prompt-agent';

const MAX_SIZE = 10 * 1024 * 1024; // 10 MB
const MAX_BODY_SIZE = MAX_SIZE + 64 * 1024; // multipart headers/fields
const MAX_DIMENSION = 4096;
const RATE_WINDOW_MS = 60_000;
const RATE_LIMIT = 8;
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
  if (!origin) return true; // stage operator/CLI requests
  const host = req.headers.get('x-forwarded-host') ?? req.headers.get('host');
  if (!host) return false;
  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}

function validPngHeader(buf: Buffer): boolean {
  if (buf.length < 24) return false;
  const signature = '89504e470d0a1a0a';
  if (buf.subarray(0, 8).toString('hex') !== signature) return false;
  if (buf.subarray(12, 16).toString('ascii') !== 'IHDR') return false;
  const width = buf.readUInt32BE(16);
  const height = buf.readUInt32BE(20);
  return width > 0 && height > 0 && width <= MAX_DIMENSION && height <= MAX_DIMENSION;
}

/**
 * POST /api/generate
 * Body: FormData with `image` (PNG sketch), optional `style`, optional
 * `prompt` (spoken by the presenter and refined by the voice prompt agent).
 * Provider keys live server-side only. The production path is Qwen-only and
 * fails closed when the provider is unavailable.
 */
export async function POST(req: Request) {
  if (!requestIsSameOrigin(req)) {
    return Response.json({ error: 'Forbidden origin' }, { status: 403 });
  }
  if (!withinRateLimit(req)) {
    return Response.json(
      { error: 'Too many generation requests' },
      { status: 429, headers: { 'Retry-After': '60' } }
    );
  }

  const contentLength = Number(req.headers.get('content-length'));
  if (Number.isFinite(contentLength) && contentLength > MAX_BODY_SIZE) {
    return Response.json({ error: 'Request too large' }, { status: 413 });
  }

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return Response.json({ error: 'Invalid request body' }, { status: 400 });
  }

  const file = form.get('image');
  if (!(file instanceof File)) {
    return Response.json({ error: 'Missing image field' }, { status: 400 });
  }
  if (file.type !== 'image/png') {
    return Response.json({ error: 'Only PNG accepted' }, { status: 400 });
  }
  if (file.size > MAX_SIZE) {
    return Response.json({ error: 'Image too large' }, { status: 413 });
  }

  const styleRaw = form.get('style');
  const style = typeof styleRaw === 'string' ? styleRaw : undefined;
  const promptRaw = form.get('prompt');
  // Trust boundary: re-sanitize server-side. Prompt refinement occurs in the
  // voice endpoint; this prevents malformed direct requests reaching Qwen.
  const prompt = typeof promptRaw === 'string' ? sanitizeSpokenPrompt(promptRaw) : undefined;
  if (!prompt) return Response.json({ error: 'Spoken prompt required' }, { status: 400 });

  const buf = Buffer.from(await file.arrayBuffer());
  if (!validPngHeader(buf)) {
    return Response.json({ error: 'Invalid PNG' }, { status: 400 });
  }

  if (!isConfigured()) {
    return Response.json({ error: 'QWEN IMAGE AI NOT CONFIGURED' }, { status: 503 });
  }

  try {
    const result = await runAgent(buf, { style, prompt, signal: req.signal });
    return Response.json({
      imageUrl: result.imageUrl,
      status: 'generated',
      engine: result.engine,
    });
  } catch (err) {
    console.error('Generation failed:', err);
    // Never leak stack traces or provider internals to the client
    return Response.json({ error: 'UNABLE TO GENERATE' }, { status: 502 });
  }
}
