/**
 * Pollinations.ai image generation — free, no API key.
 * Used as the actual rendering engine when QWEN_API_KEY is not set,
 * and as the fallback provider in mock mode.
 */

export interface PollinationsOptions {
  width?: number;
  height?: number;
  style?: string;
  seed?: number;
}

/**
 * Generate an image from a text prompt. Returns a public URL.
 * The URL can be used directly as <img src>.
 */
export function buildImageUrl(prompt: string, opts: PollinationsOptions = {}): string {
  const { width = 1024, height = 1024, seed } = opts;
  const params = new URLSearchParams({
    width: String(width),
    height: String(height),
    nologo: 'true',
    model: 'flux',
  });
  if (seed !== undefined) params.set('seed', String(seed));
  return `https://image.pollinations.ai/prompt/${encodeURIComponent(prompt)}?${params}`;
}

/**
 * Fetch the generated image and return it as a data URL.
 * Server-side only (avoids CORS in the browser).
 */
export async function generateImageFromPrompt(
  prompt: string,
  opts: PollinationsOptions = {}
): Promise<string> {
  const url = buildImageUrl(prompt, opts);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 90_000);
  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) throw new Error(`Pollinations HTTP ${res.status}`);
    const buf = Buffer.from(await res.arrayBuffer());
    const contentType = res.headers.get('content-type') ?? 'image/jpeg';
    return `data:${contentType};base64,${buf.toString('base64')}`;
  } finally {
    clearTimeout(timeout);
  }
}
