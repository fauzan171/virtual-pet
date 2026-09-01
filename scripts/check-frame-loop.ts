import { shouldProcessVideoFrame } from '../lib/frame-loop.ts';

function assert(cond: boolean, msg: string): void {
  if (!cond) {
    console.error('FAIL:', msg);
    process.exitCode = 1;
  }
}

assert(shouldProcessVideoFrame(-1, 0), 'first decoded video frame must run');
assert(!shouldProcessVideoFrame(1.25, 1.25), 'duplicate video timestamp must be skipped');
assert(shouldProcessVideoFrame(1.25, 1.283), 'new decoded video frame must run');
assert(!shouldProcessVideoFrame(2, 1.9), 'older timestamp must not be reprocessed');

if (!process.exitCode) console.log('all frame loop checks pass');
