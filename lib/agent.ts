/**
 * AI Air Canvas generation agent.
 *
 * The production path is deliberately Qwen-only. A provider failure is shown
 * as a failure instead of silently returning an unrelated text-only image.
 */

import { generateImage, isConfigured as isQwenConfigured } from './qwen-provider.ts';

export interface AgentOptions {
  style?: string;
  /** Prompt spoken by the presenter and refined by the server-side prompt agent. */
  prompt: string;
  signal?: AbortSignal;
}

export interface AgentResult {
  imageUrl: string;
  engine: 'qwen';
}

export async function runAgent(
  sketchPng: Buffer,
  opts: AgentOptions
): Promise<AgentResult> {
  if (!isQwenConfigured()) throw new Error('Qwen image provider not configured');
  if (!opts.prompt?.trim()) throw new Error('Generation requires a spoken prompt');
  const { imageUrl } = await generateImage(sketchPng, {
    style: opts.style,
    prompt: opts.prompt,
    signal: opts.signal,
  });
  return { imageUrl, engine: 'qwen' };
}
