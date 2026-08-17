const MAX_SIZE = 10 * 1024 * 1024; // 10 MB

/**
 * POST /api/generate
 * Phase 1 placeholder: receives the sketch PNG and echoes it back as a data URL
 * so the RESULT screen has something to display.
 * Phase 4: replace the body with a real call to wan2.7-image-pro.
 * QWEN_API_KEY stays server-side only — never in the browser bundle.
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

  // Simulate generation latency for realistic stage pacing
  await new Promise((r) => setTimeout(r, 1500));

  // Echo sketch back as data URL until real provider wired (Phase 4)
  const buf = Buffer.from(await file.arrayBuffer());
  const dataUrl = `data:image/png;base64,${buf.toString('base64')}`;

  return Response.json({
    imageUrl: dataUrl,
    status: 'mock',
    message: 'Placeholder — real wan2.7-image-pro integration in Phase 4',
  });
}
