import { runAgent } from '../lib/agent.ts';

function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error(`FAIL: ${msg}`);
}

const originalFetch = globalThis.fetch;
const originalUrl = process.env.QWEN_API_URL;
const originalKey = process.env.QWEN_API_KEY;

process.env.QWEN_API_URL = 'https://test.maas.aliyuncs.com/v1';
process.env.QWEN_API_KEY = 'test-only';

let requests = 0;
globalThis.fetch = (async () => {
  requests++;
  return new Response('{"error":"provider unavailable"}', { status: 401 });
}) as typeof fetch;

try {
  let rejected = false;
  try {
    await runAgent(Buffer.from('not-used-by-mock'), { prompt: 'a red dragon' });
  } catch {
    rejected = true;
  }

  assert(rejected, 'provider failure must fail closed instead of returning a fallback image');
  assert(requests === 1, `no fallback provider may run; observed ${requests} requests`);
  console.log('all agent fallback checks pass');
} finally {
  globalThis.fetch = originalFetch;
  if (originalUrl === undefined) delete process.env.QWEN_API_URL;
  else process.env.QWEN_API_URL = originalUrl;
  if (originalKey === undefined) delete process.env.QWEN_API_KEY;
  else process.env.QWEN_API_KEY = originalKey;
}
