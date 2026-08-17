import { generateImage, isConfigured } from '@/lib/qwen-provider';

const MAX_SIZE = 10 * 1024 * 1024; // 10 MB

/**
 * POST /api/generate
 * Body: FormData with `image` (PNG sketch).
 * When QWEN_API_URL/QWEN_API_KEY are configured it calls wan2.7-image-pro via
 * the server-side adapter; otherwise it echoes the sketch back so the demo UI
 * is fully testable. API keys live server-side only.
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

  const buf = Buffer.from(await file.arrayBuffer());

  if (!isConfigured()) {
    // Mock mode: echo sketch so RESULT screen works before provider is wired
    await new Promise((r) => setTimeout(r, 1500));
    return Response.json({
      imageUrl: `data:image/png;base64,${buf.toString('base64')}`,
      status: 'mock',
    });
  }

  try {
    const { imageUrl } = await generateImage(buf);
    return Response.json({ imageUrl, status: 'generated' });
  } catch (err) {
    console.error('Generation failed:', err);
    // Never leak stack traces or provider internals to the client
    return Response.json({ error: 'UNABLE TO GENERATE' }, { status: 502 });
  }
}
