import { shouldActivateControl, updateDwell, initialDwell } from '../lib/control-selection.ts';

function assert(cond: boolean, msg: string): void {
  if (!cond) {
    console.error('FAIL:', msg);
    process.exitCode = 1;
  }
}

assert(!shouldActivateControl(false, false), 'hover alone must never activate a control');
assert(shouldActivateControl(true, false), 'pinch rising edge must activate a control');
assert(!shouldActivateControl(true, true), 'held pinch must not activate repeatedly');
assert(!shouldActivateControl(false, true), 'pinch release must not activate a control');

// Dwell-to-select
const DWELL = 900;
// entering a control starts the timer, no immediate fire
let d = updateDwell(initialDwell, 'UNDO', 1000, DWELL);
assert(!d.activated && d.state.key === 'UNDO' && d.state.since === 1000, 'dwell starts on entry');
// before the dwell elapses: no fire
d = updateDwell(d.state, 'UNDO', 1000 + DWELL - 1, DWELL);
assert(!d.activated, 'dwell must not fire early');
// at/after the dwell elapses: fire once
d = updateDwell(d.state, 'UNDO', 1000 + DWELL, DWELL);
assert(d.activated, 'dwell fires after holding long enough');
// staying on the same control: never fires twice
d = updateDwell(d.state, 'UNDO', 1000 + DWELL * 3, DWELL);
assert(!d.activated, 'dwell must not re-fire while still on the control');
// leaving and returning re-arms
d = updateDwell(d.state, null, 2000, DWELL);
d = updateDwell(d.state, 'CLEAR', 3000, DWELL);
d = updateDwell(d.state, 'CLEAR', 3000 + DWELL, DWELL);
assert(d.activated && d.state.key === 'CLEAR', 'dwell re-arms after leaving the control');
// sweeping across controls never fires
d = updateDwell(initialDwell, 'UNDO', 0, DWELL);
d = updateDwell(d.state, 'CLEAR', 400, DWELL);
d = updateDwell(d.state, 'GENERATE', 800, DWELL);
d = updateDwell(d.state, null, 1200, DWELL);
assert(!d.activated, 'sweeping across controls must not fire');

if (!process.exitCode) console.log('all control selection checks pass');
