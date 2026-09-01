/** Decide whether the current hand input should activate a hovered control. */
export function shouldActivateControl(
  pinching: boolean,
  previousPinching: boolean
): boolean {
  return pinching && !previousPinching;
}

export interface DwellState {
  key: string | null;
  since: number;
  fired: boolean;
}

export const initialDwell: DwellState = { key: null, since: 0, fired: false };

/**
 * Dwell-to-select: aiming at a control and holding it activates — no pinch
 * needed. The cursor must leave the control before the same one can fire
 * again, so resting on a node never machine-guns clicks.
 */
export function updateDwell(
  state: DwellState,
  key: string | null,
  nowMs: number,
  dwellMs: number
): { state: DwellState; activated: boolean } {
  if (key !== state.key) return { state: { key, since: nowMs, fired: false }, activated: false };
  if (state.fired || nowMs - state.since < dwellMs) return { state, activated: false };
  return { state: { key, since: state.since, fired: true }, activated: true };
}
