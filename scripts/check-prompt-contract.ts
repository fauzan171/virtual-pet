import { buildPrompt, extractImageUrl } from '../lib/qwen-provider.ts';
import { isTrustedQwenBaseUrl } from '../lib/qwen-config.ts';
import { STYLES } from '../lib/prompt.ts';

function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error(`FAIL: ${msg}`);
}

const base = buildPrompt();
for (const required of [
  'spoken user\'s text prompt as the source of truth for subject identity',
  'sketch as the source of truth for scene layout',
  'Do not replace the prompted subject',
  'relative sizes, positions, orientation, perspective',
  'style changes rendering, materials, lighting, and atmosphere only',
]) {
  assert(base.includes(required), `hidden prompt is missing its contract: ${required}`);
}

for (const [style, description] of Object.entries(STYLES)) {
  const prompt = buildPrompt(style, 'a red dragon beside a tower');
  assert(prompt.includes(description), `${style} description must reach the provider prompt`);
  assert(prompt.includes('a red dragon beside a tower'), `${style} must include the spoken prompt`);
  assert(prompt.includes('Preserve every structural constraint above'), `${style} must not override sketch fidelity`);
}

assert(
  buildPrompt('UNKNOWN') === base,
  'unknown client-provided styles must not alter the provider prompt'
);

assert(
  buildPrompt(undefined, 'a blue bicycle').includes('SPOKEN USER PROMPT\na blue bicycle'),
  'spoken prompt must reach Qwen as text'
);

assert(isTrustedQwenBaseUrl('https://token-plan.ap-southeast-1.maas.aliyuncs.com/compatible-mode/v1'), 'Alibaba MaaS gateway must be trusted');
assert(!isTrustedQwenBaseUrl('https://attacker.example/v1'), 'arbitrary key destination must be rejected');
assert(!isTrustedQwenBaseUrl('http://token-plan.ap-southeast-1.maas.aliyuncs.com/v1'), 'non-TLS key destination must be rejected');
assert(Boolean(extractImageUrl({ data: [{ url: 'https://dashscope-result.oss-accelerate.aliyuncs.com/result.png' }] })), 'Alibaba result URL must be accepted');
assert(extractImageUrl({ data: [{ url: 'https://tracker.example/result.png' }] }) === null, 'arbitrary provider result URL must be rejected');

console.log('all prompt contract checks pass');
