/**
 * Live image-to-image theme matrix against the configured Qwen gateway.
 * Generates the same sketch in every UI style and saves inspectable artifacts.
 * Costs four image generations.
 */
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import nextEnv from '@next/env';
import { STYLES } from '../lib/prompt.ts';
import { generateImage } from '../lib/qwen-provider.ts';

nextEnv.loadEnvConfig(process.cwd());

const artifactDir = join(process.cwd(), 'artifacts', 'qwen-theme-matrix');
const sketchPath = join(process.cwd(), 'artifacts', 'qwen-i2i-proof', 'sketch.png');
const sketch = await readFile(sketchPath);
await mkdir(artifactDir, { recursive: true });
await writeFile(join(artifactDir, 'sketch.png'), sketch);

const prompt = 'A simple modern house with exactly one tree on the right and one sun in the upper right; preserve their positions and the house silhouette.';
const results = [];
const resume = process.argv.includes('--resume');

for (const style of Object.keys(STYLES)) {
  let image: Buffer | undefined;
  let filename = '';
  for (const extension of resume ? ['png', 'jpg', 'webp'] : []) {
    try {
      filename = `${style.toLowerCase()}.${extension}`;
      image = await readFile(join(artifactDir, filename));
      console.log(`PASS: ${style} reused ${filename} (${image.length} bytes)`);
      break;
    } catch {
      image = undefined;
    }
  }

  if (!image) {
    let imageUrl = '';
    for (let attempt = 1; attempt <= 2; attempt++) {
      try {
        imageUrl = (await generateImage(sketch, { style, prompt })).imageUrl;
        break;
      } catch (error) {
        if (attempt === 2 || !(error instanceof DOMException && error.name === 'AbortError')) throw error;
        console.log(`RETRY: ${style} timed out on attempt ${attempt}`);
      }
    }
    const response = await fetch(imageUrl);
    if (!response.ok) throw new Error(`FAIL: ${style} result download returned HTTP ${response.status}`);
    image = Buffer.from(await response.arrayBuffer());
  }
  const isPng = image.subarray(0, 8).toString('hex') === '89504e470d0a1a0a';
  const isJpeg = image.subarray(0, 3).toString('hex') === 'ffd8ff';
  const isWebp = image.subarray(0, 4).toString('ascii') === 'RIFF' && image.subarray(8, 12).toString('ascii') === 'WEBP';
  if (!isPng && !isJpeg && !isWebp) throw new Error(`FAIL: ${style} returned a non-image artifact`);
  const extension = isPng ? 'png' : isJpeg ? 'jpg' : 'webp';
  filename = `${style.toLowerCase()}.${extension}`;
  await writeFile(join(artifactDir, filename), image);
  results.push({
    style,
    filename,
    bytes: image.length,
    sha256: createHash('sha256').update(image).digest('hex'),
    engine: process.env.QWEN_MODEL ?? 'qwen-image-3.0-pro',
  });
  console.log(`PASS: ${style} verified ${filename} (${image.length} bytes)`);
}

if (new Set(results.map((result) => result.sha256)).size !== results.length) {
  throw new Error('FAIL: two or more styles returned byte-identical images');
}

await writeFile(
  join(artifactDir, 'proof.json'),
  JSON.stringify({ generatedAt: new Date().toISOString(), sketch: 'sketch.png', prompt, results }, null, 2),
);
console.log(`PASS: all ${results.length} themes produced distinct real images`);
