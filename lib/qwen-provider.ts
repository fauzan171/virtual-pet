/**
 * Server-side adapter for qwen-image-3.0-pro via the Alibaba MaaS gateway
 * (OpenAI-compatible mode). Verified against the live endpoint 2026-08-19.
 *
 * Request:  POST {QWEN_API_URL}/chat/completions
 * Content uses DashScope-native items: [{"image": dataUrl}, {"text": prompt}]
 * — the OpenAI {"type":"image_url",...} shape is NOT accepted by image models.
 * Response: choices[0].message.content[0].image → signed OSS URL.
 */

import { DEFAULT_PROMPT, STYLES, type StyleKey } from './prompt.ts';

export interface GenerateOptions {
  style?: string;
}

export interface GenerateResult {
  imageUrl: string; // data URL or http(s) URL
}

function buildPrompt(style?: string): string {
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
  const baseUrl = process.env.QWEN_API_URL;
  const apiKey = process.env.QWEN_API_KEY;
  const model = process.env.QWEN_MODEL ?? 'qwen-image-3.0-pro';
  if (!baseUrl || !apiKey) throw new Error('Provider not configured');

  const dataUrl = `data:image/png;base64,${sketchPng.toString('base64')}`;
  const prompt = buildPrompt(options.style);

  const controller = new AbortController();
  // ponytail: image gen observed at 20-90s; raise if larger resolutions land
  const timeout = setTimeout(() => controller.abort(), 180_000);

  try {
    const res = await fetch(`${baseUrl.replace(/\/$/, '')}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        messages: [
          {
            role: 'user',
            content: [{ image: dataUrl }, { text: prompt }],
          },
        ],
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

interface ContentItem {
  image?: string;
}
interface ProviderShape {
  output?: { choices?: { message?: { content?: ContentItem[] } }[] };
  choices?: { message?: { content?: ContentItem[] } }[];
  data?: { url?: string }[];
}

function extractImageUrl(data: unknown): string | null {
  const d = data as ProviderShape;
  return (
    d?.output?.choices?.[0]?.message?.content?.find((c) => c.image)?.image ??
    d?.choices?.[0]?.message?.content?.find((c) => c.image)?.image ??
    d?.data?.[0]?.url ??
    null
  );
}
