/**
 * Server-side adapter for the wan2.7-image-pro image generation API.
 *
 * ⚠ Model API shape unverified (model not found in public docs at pivot time).
 * This adapter implements the common DashScope multimodal-generation pattern:
 *   POST {QWEN_API_URL} with role-based messages carrying {image: dataUrl} + {text: prompt}.
 * If the real provider differs (e.g. input.reference_image / a polling task API),
 * only this file changes — the route and frontend stay untouched.
 */

import { DEFAULT_PROMPT, STYLES, type StyleKey } from './prompt';

export interface GenerateOptions {
  style?: string;
}

export interface GenerateResult {
  imageUrl: string; // data URL or http(s) URL
}

function buildPrompt(style?: string): string {
  // Style arrives as a key ("REALISTIC"); send the human description instead
  const desc = style && style in STYLES ? STYLES[style as StyleKey] : null;
  const styleLine = desc ? `\n\nApply this visual style: ${desc}.` : '';
  return DEFAULT_PROMPT + styleLine;
}

/**
 * Returns true when the provider is configured via env vars.
 * The route falls back to mock mode when this is false.
 */
export function isConfigured(): boolean {
  return Boolean(process.env.QWEN_API_KEY && process.env.QWEN_API_URL);
}

export async function generateImage(
  sketchPng: Buffer,
  options: GenerateOptions = {}
): Promise<GenerateResult> {
  const apiUrl = process.env.QWEN_API_URL;
  const apiKey = process.env.QWEN_API_KEY;
  const model = process.env.QWEN_MODEL ?? 'wan2.7-image-pro';
  if (!apiUrl || !apiKey) throw new Error('Provider not configured');

  const dataUrl = `data:image/png;base64,${sketchPng.toString('base64')}`;
  const prompt = buildPrompt(options.style);

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 60_000);

  try {
    const res = await fetch(apiUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        input: {
          messages: [
            {
              role: 'user',
              content: [{ image: dataUrl }, { text: prompt }],
            },
          ],
        },
      }),
      signal: controller.signal,
    });

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`Provider HTTP ${res.status}: ${text.slice(0, 200)}`);
    }

    const data = await res.json();
    const imageUrl = extractImageUrl(data);
    if (!imageUrl) throw new Error('Provider response contained no image');
    return { imageUrl };
  } finally {
    clearTimeout(timeout);
  }
}

/** Ponytail: tolerates several common response shapes; tighten once real API verified. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function extractImageUrl(data: any): string | null {
  return (
    data?.output?.results?.[0]?.url ??
    data?.output?.image_url ??
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    data?.output?.choices?.[0]?.message?.content?.find((c: any) => c.image)?.image ??
    data?.images?.[0]?.url ??
    data?.data?.[0]?.url ??
    null
  );
}
