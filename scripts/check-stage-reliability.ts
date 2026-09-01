import {
  isAllowedGeneratedImageUrl,
  scaleStrokeInPlace,
  shouldSplitReacquiredStroke,
} from '../lib/stage-reliability.ts';
import type { Stroke } from '../lib/types.ts';

function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error(`FAIL: ${msg}`);
}

assert(
  shouldSplitReacquiredStroke(2, { x: 10, y: 10 }, { x: 200, y: 10 }),
  'large cursor jump after tracking dropout must split the stroke'
);
assert(
  !shouldSplitReacquiredStroke(0, { x: 10, y: 10 }, { x: 200, y: 10 }),
  'fast continuous movement without tracking loss must stay connected'
);
assert(
  !shouldSplitReacquiredStroke(2, { x: 10, y: 10 }, { x: 20, y: 20 }),
  'small re-acquisition movement must preserve the stroke'
);

const stroke: Stroke = { points: [{ x: 10, y: 20 }, { x: 30, y: 40 }], width: 5, color: '#000' };
scaleStrokeInPlace(stroke, 2, 0.5);
assert(stroke.points[0].x === 20 && stroke.points[0].y === 10, 'resize must scale stored points');
assert(stroke.width === 5, 'anisotropic resize must preserve geometric-mean stroke width');

assert(isAllowedGeneratedImageUrl('data:image/png;base64,AAAA'), 'PNG data URL must be accepted');
assert(isAllowedGeneratedImageUrl('https://dashscope-result.oss-accelerate.aliyuncs.com/result.png'), 'trusted Alibaba image URL must be accepted');
assert(!isAllowedGeneratedImageUrl('https://images.example/result.png'), 'untrusted HTTPS image URL must be rejected');
assert(!isAllowedGeneratedImageUrl('http://dashscope-result.oss-accelerate.aliyuncs.com/result.png'), 'insecure Alibaba image URL must be rejected');
assert(!isAllowedGeneratedImageUrl('javascript:alert(1)'), 'executable URL must be rejected');
assert(!isAllowedGeneratedImageUrl('data:text/html;base64,AAAA'), 'non-image data URL must be rejected');

console.log('all stage reliability checks pass');
