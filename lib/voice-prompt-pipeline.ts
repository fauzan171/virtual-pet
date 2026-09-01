import { enforceRefinedPrompt, refineSpokenPrompt } from './prompt-agent.ts';
import { transcribePcm16 } from './qwen-realtime-asr.ts';

export interface VoicePromptPipelineResult {
  transcript: string;
  prompt: string;
  layers: Array<{
    id: 'speech_recognition' | 'semantic_correction' | 'deterministic_guard';
    engine: string;
    status: 'passed';
  }>;
}

/**
 * Deep module for the complete voice-understanding seam. It fails closed:
 * callers receive no prompt unless ASR, semantic correction, and the local
 * deterministic guard all pass.
 */
export async function understandVoicePrompt(
  pcm: Buffer,
  sketchPng?: Buffer,
  signal?: AbortSignal,
): Promise<VoicePromptPipelineResult> {
  const transcript = await transcribePcm16(pcm, signal);
  const modelPrompt = await refineSpokenPrompt(transcript, sketchPng, signal);
  const prompt = enforceRefinedPrompt(modelPrompt);
  if (!prompt) throw new Error('Prompt rejected by deterministic guard');

  return {
    transcript,
    prompt,
    layers: [
      {
        id: 'speech_recognition',
        engine: process.env.QWEN_ASR_MODEL ?? 'qwen-audio-3.0-realtime-plus',
        status: 'passed',
      },
      {
        id: 'semantic_correction',
        engine: process.env.QWEN_PROMPT_MODEL ?? 'qwen3.7-plus',
        status: 'passed',
      },
      { id: 'deterministic_guard', engine: 'local-rules', status: 'passed' },
    ],
  };
}
