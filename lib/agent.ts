/**
 * AI Air Canvas generation agent.
 *
 * Two paths:
 *   A. Qwen img2img (needs QWEN_API_KEY) — sketch goes to the model directly,
 *      visual correspondence is preserved. This is the full experience.
 *   B. Pollinations text-to-image (free, no key) — used as fallback so the
 *      show flow works before the provider key arrives. Since the sketch
 *      can't be sent to a text-only model, the subject comes from the
 *      voice command (e.g. "generate a dragon") plus the selected style.
 *
 * The voice engine passes `subjectHint`; the route forwards it here.
 */

import { DEFAULT_PROMPT, STYLES, type StyleKey } from './prompt';
import { generateImageFromPrompt } from './pollinations';
import { generateImage, isConfigured as isQwenConfigured } from './qwen-provider';

export interface AgentOptions {
  style?: string;
  /** Subject spoken by the presenter, e.g. "a dragon". Empty = unknown. */
  subjectHint?: string;
}

export interface AgentResult {
  imageUrl: string;
  engine: 'qwen' | 'pollinations';
}

function styleLine(style?: string): string {
  if (!style || !(style in STYLES)) return '';
  return `\n\nApply this visual style: ${STYLES[style as StyleKey]}.`;
}

export async function runAgent(
  sketchPng: Buffer,
  opts: AgentOptions = {}
): Promise<AgentResult> {
  // Path A: real img2img via Qwen
  if (isQwenConfigured()) {
    try {
      const { imageUrl } = await generateImage(sketchPng, { style: opts.style });
      return { imageUrl, engine: 'qwen' };
    } catch (err) {
      console.error('Qwen failed, falling back to Pollinations:', err);
    }
  }

  // Path B: Pollinations text-to-image.
  // Compose the prompt from the spoken subject (if any) + style + default.
  const subject = opts.subjectHint?.trim();
  const prompt = subject
    ? `A polished, highly detailed image of ${subject}.` +
      styleLine(opts.style) +
      `\n\n${DEFAULT_PROMPT}`
    : DEFAULT_PROMPT + styleLine(opts.style);

  const imageUrl = await generateImageFromPrompt(prompt, {
    width: 1024,
    height: 1024,
  });
  return { imageUrl, engine: 'pollinations' };
}
