import WebSocket from 'ws';
import { isTrustedQwenBaseUrl, trustedQwenBaseUrl } from './qwen-config.ts';

const DEFAULT_MODEL = 'qwen-audio-3.0-realtime-plus';
const TIMEOUT_MS = 35_000;
const PCM_CHUNK_BYTES = 3_200; // 100 ms at 16 kHz, 16-bit mono

function realtimeUrl(baseUrl: string, model: string): string {
  const url = new URL(baseUrl);
  url.protocol = 'wss:';
  url.pathname = '/api-ws/v1/realtime';
  url.search = new URLSearchParams({ model }).toString();
  return url.toString();
}

interface RealtimeEvent {
  type?: string;
  transcript?: string;
  error?: { message?: string };
}

export function isVoiceConfigured(): boolean {
  return Boolean(process.env.QWEN_API_KEY && isTrustedQwenBaseUrl(process.env.QWEN_API_URL));
}

export async function transcribePcm16(pcm: Buffer, signal?: AbortSignal): Promise<string> {
  const apiKey = process.env.QWEN_API_KEY;
  const baseUrl = trustedQwenBaseUrl(process.env.QWEN_API_URL);
  const model = process.env.QWEN_ASR_MODEL ?? DEFAULT_MODEL;
  if (!apiKey) throw new Error('Voice provider not configured');
  if (pcm.length < PCM_CHUNK_BYTES) throw new Error('Audio is too short');

  return new Promise<string>((resolve, reject) => {
    let settled = false;
    const ws = new WebSocket(realtimeUrl(baseUrl, model), {
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'x-dashscope-dataInspection': 'disable',
      },
    });
    const timer = setTimeout(() => finish(new Error('Voice provider timed out')), TIMEOUT_MS);
    const finish = (error?: Error, transcript?: string) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
      ws.close();
      if (error) reject(error);
      else resolve(transcript ?? '');
    };
    const onAbort = () => finish(new DOMException('Aborted', 'AbortError'));
    signal?.addEventListener('abort', onAbort, { once: true });

    ws.on('open', () => {
      ws.send(JSON.stringify({
        type: 'session.update',
        session: {
          modalities: ['text'],
          instructions: 'Transcribe the user audio faithfully. Do not answer it.',
          input_audio_format: 'pcm',
          output_audio_format: 'pcm',
          turn_detection: null,
        },
      }));
      for (let offset = 0; offset < pcm.length; offset += PCM_CHUNK_BYTES) {
        ws.send(JSON.stringify({
          type: 'input_audio_buffer.append',
          audio: pcm.subarray(offset, offset + PCM_CHUNK_BYTES).toString('base64'),
        }));
      }
      ws.send(JSON.stringify({ type: 'input_audio_buffer.commit' }));
      ws.send(JSON.stringify({ type: 'response.create', response: { modalities: ['text'] } }));
    });
    ws.on('message', (raw) => {
      let event: RealtimeEvent;
      try {
        event = JSON.parse(raw.toString()) as RealtimeEvent;
      } catch {
        return;
      }
      if (event.type === 'conversation.item.input_audio_transcription.completed') {
        const transcript = event.transcript?.trim();
        if (!transcript) finish(new Error('Voice provider returned an empty transcript'));
        else finish(undefined, transcript);
      } else if (event.type === 'error') {
        finish(new Error(event.error?.message || 'Voice provider error'));
      }
    });
    ws.on('error', () => finish(new Error('Voice provider connection failed')));
    ws.on('close', () => {
      if (!settled) finish(new Error('Voice provider closed before transcription'));
    });
  });
}
