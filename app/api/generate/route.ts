import { runAgent } from '@/lib/agent';
import { isConfigured } from '@/lib/qwen-provider';
import { sanitizeSubject } from '@/lib/voice';

const MAX_SIZE = 10 * 1024 * 1024; // 10 MB

/**
 * POST /api/generate
 * Body: FormData with `image` (PNG sketch), optional `style`, optional
 * `subject` (spoken by the presenter, used by the Pollinations fallback).
 * Provider keys live server-side only. Without keys the Pollinations
 * free engine renders the image so the full show flow still works.
 */
export async function POST(req: Request) {
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
  const subjectRaw = form.get('subject');
  // Trust boundary: re-sanitize server-side. A misheard or crafted subject
  // must not reach the image model raw.
  const subject = typeof subjectRaw === 'string' ? sanitizeSubject(subjectRaw) : undefined;

  const buf = Buffer.from(await file.arrayBuffer());

  // Mock mode: no subject and no key → echo the sketch so RESULT screen
  // works fully offline (e.g. venue without internet).
  if (!isConfigured() && !subject) {
    await new Promise((r) => setTimeout(r, 1500));
    return Response.json({
      imageUrl: `data:image/png;base64,${buf.toString('base64')}`,
      status: 'mock',
      engine: 'mock',
    });
  }

  try {
    const result = await runAgent(buf, { style, subjectHint: subject });
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
