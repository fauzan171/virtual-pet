import { commandFingerCount, GestureHoldDetector } from '../lib/gestures.ts';

function assert(cond: boolean, msg: string): void {
  if (!cond) {
    console.error('FAIL:', msg);
    process.exitCode = 1;
  }
}

const openPalm = commandFingerCount({ fingerCount: 5, thumbOut: true, twoFingers: false });
assert(openPalm === 5, `open palm must open the command wheel, received ${openPalm}`);

assert(
  commandFingerCount({ fingerCount: 2, thumbOut: false, twoFingers: true }) === 2,
  'index + middle must open the color picker'
);

const hold = new GestureHoldDetector();
assert(hold.update(5, 0) === null, 'open palm must start a hold window');
assert(hold.update(5, 159) === null, 'open palm must not fire before 160ms');
assert(hold.update(5, 160) === 5, 'open palm must fire at 160ms independent of FPS');
assert(hold.update(5, 500) === null, 'held pose must fire only once');
hold.update(0, 501);
assert(hold.update(5, 600) === null, 'released pose can start a fresh hold');
assert(hold.update(5, 760) === 5, 'fresh open palm must fire again');
assert(
  commandFingerCount({ fingerCount: 2, thumbOut: false, twoFingers: false }) === 0,
  'an ambiguous two-finger pose must not trigger'
);
assert(
  commandFingerCount({ fingerCount: 4, thumbOut: false, twoFingers: false }) === 4,
  'four non-thumb fingers must toggle the eraser'
);

if (!process.exitCode) console.log('all gesture checks pass');
