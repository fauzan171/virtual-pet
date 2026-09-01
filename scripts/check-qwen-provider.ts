/**
 * End-to-end check for lib/qwen-provider.ts against the live gateway.
 * Run: npm run check:qwen
 * Costs one image generation. Loads .env.local manually (no Next.js runtime).
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { generateImage, isConfigured } from '../lib/qwen-provider.ts';

// ponytail: one-off env load; swap for dotenv if more scripts need it
for (const line of readFileSync(join(process.cwd(), '.env.local'), 'utf8').split('\n')) {
  const m = line.match(/^([A-Z_]+)=(.*)$/);
  if (m) process.env[m[1]] = m[2];
}

if (!isConfigured()) throw new Error('FAIL: isConfigured() false — .env.local missing keys');

// 64x64 solid PNG (model rejects <10px)
const png = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAEAAAABACAIAAAAlC+aJAAAAeUlEQVR4nO3PQQkAMAzAwGqqfwGTNRF7HINABFzm7H7dcEEDWtCAFjSgBQ1oQQNa0IAWNKAFDWhBA1rQgBY0oAUNaEEDWtCAFjSgBQ1oQQNa0IAWNKAFDWhBA1rQgBY0oAUNaEEDWtCAFjSgBQ1oQQNa0IAWNKAFj10ThMEPv3x7AAAAAABJRU5ErkJggg==',
  'base64'
);

const { imageUrl } = await generateImage(png, {
  style: 'CINEMATIC',
  prompt: 'A single red sphere centered in the composition',
});
if (!/^https?:\/\//.test(imageUrl)) throw new Error(`FAIL: bad imageUrl: ${imageUrl.slice(0, 80)}`);
console.log('PASS: image generated →', imageUrl.slice(0, 100) + '...');
