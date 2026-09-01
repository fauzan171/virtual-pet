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
import { isTrustedQwenBaseUrl, trustedQwenBaseUrl } from './qwen-config.ts';

export interface GenerateOptions {
  style?: string;
  prompt: string;
  signal?: AbortSignal;
}

export interface GenerateResult {
  imageUrl: string; // data URL or http(s) URL
}

export function buildPrompt(style?: string, spokenPrompt?: string): string {
  const desc = style && style in STYLES ? STYLES[style as StyleKey] : null;
  const intentLine = spokenPrompt?.trim()
    ? `\n\nSPOKEN USER PROMPT\n${spokenPrompt.trim()}`
    : '';
  const styleLine = desc
    ? `\n\nSELECTED VISUAL STYLE\nApply this style after understanding the sketch: ${desc}. Preserve every structural constraint above.`
    : '';
  return DEFAULT_PROMPT + intentLine + styleLine;
}

/**
 * Returns true only when credentials and a trusted Alibaba gateway are set.
 * The route fails closed when this is false.
 */
export function isConfigured(): boolean {
  return Boolean(process.env.QWEN_API_KEY && isTrustedQwenBaseUrl(process.env.QWEN_API_URL));
}

export async function generateImage(
  sketchPng: Buffer,
  options: GenerateOptions
): Promise<GenerateResult> {
  const baseUrl = trustedQwenBaseUrl(process.env.QWEN_API_URL);
  const apiKey = process.env.QWEN_API_KEY;
  const model = process.env.QWEN_MODEL ?? 'qwen-image-3.0-pro';
  if (!apiKey) throw new Error('Provider not configured');

  const dataUrl = `data:image/png;base64,${sketchPng.toString('base64')}`;
  const prompt = buildPrompt(options.style, options.prompt);

  const controller = new AbortController();
  const abortFromCaller = () => controller.abort();
  options.signal?.addEventListener('abort', abortFromCaller, { once: true });
  // Stage-size image-to-image calls can exceed three minutes under provider load.
  // Keep a hard ceiling, but allow enough room for a real 1024×768 sketch.
  const timeout = setTimeout(() => controller.abort(), 300_000);

  try {
    const res = await fetch(`${baseUrl.replace(/\/$/, '')}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        // Stage mode favors predictable 1K output and skips two optional
        // preprocessing/reasoning passes. The Pro image model and the full
        // sketch-to-image prompt remain unchanged.
        size: '1024*1024',
        n: 1,
        prompt_extend: false,
        enable_thinking: false,
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
      throw new Error(`Provider HTTP ${res.status}`);
    }

    const data = await res.json();
    const imageUrl = extractImageUrl(data);
    if (!imageUrl) throw new Error('Provider response contained no image');
    return { imageUrl };
  } finally {
    clearTimeout(timeout);
    options.signal?.removeEventListener('abort', abortFromCaller);
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

export function extractImageUrl(data: unknown): string | null {
  const d = data as ProviderShape;
  const imageUrl = (
    d?.output?.choices?.[0]?.message?.content?.find((c) => c.image)?.image ??
    d?.choices?.[0]?.message?.content?.find((c) => c.image)?.image ??
    d?.data?.[0]?.url ??
    null
  );
  if (typeof imageUrl !== 'string') return null;
  if (/^data:image\/(?:png|jpeg|webp);base64,/.test(imageUrl)) {
    return imageUrl.length <= 15 * 1024 * 1024 ? imageUrl : null;
  }
  try {
    const url = new URL(imageUrl);
    return url.protocol === 'https:' && url.hostname.endsWith('.aliyuncs.com') ? imageUrl : null;
  } catch {
    return null;
  }
}
