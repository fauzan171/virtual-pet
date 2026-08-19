export const CAMERA = { width: 1280, height: 720 };

// One-Euro Filter (pixel space). mincutoff = stillness: lower = steadier at
// rest. beta = speed responsiveness: higher = less lag on fast sweeps.
// 0.5/0.04 = pen feel: heavy jitter kill at rest, and the adaptive cutoff
// stays LOW during motion so hand tremor is smoothed out of strokes.
// Previously beta was 0.12 — cutoff spiked during movement and the filter
// passed tremor straight through, making strokes shaky.
export const ONE_EURO_MIN_CUTOFF = 0.5;
export const ONE_EURO_BETA = 0.04;
export const ONE_EURO_D_CUTOFF = 1.0;

// Minimum cursor travel before a point joins the live stroke. Swallows the
// ~1-2px of residual tracking jitter so a held hand draws no wiggle — like
// a real pen whose tip doesn't slide while the hand holds position.
export const PEN_DEADZONE_PX = 3.0;

// Center fraction of camera frame mapped to full canvas
export const REGION = 0.75;

// Pinch detection thresholds (hysteresis), expressed as a ratio of the
// thumb-tip↔index-tip distance to the hand span (wrist→middle MCP).
// Normalizing by hand size keeps the pinch state stable regardless of how
// far the hand is from the camera.
export const PINCH_ON = 0.28;
export const PINCH_OFF = 0.42;

// Frames the pinch must stay released before the open stroke is committed.
// Prevents brief pinch wobbles during fast drawing from splitting one line
// into multiple strokes.
export const PINCH_RELEASE_GRACE_FRAMES = 8;

export const BUTTON_DEBOUNCE_MS = 500;
export const CLEAR_CONFIRM_TIMEOUT_MS = 3000;

// Multi-finger gesture menu: hold N fingers for HOLD_FRAMES to trigger.
// 3 = shape picker, 4 = eraser toggle, 5 = undo. Thumb excluded (pinch finger).
export const GESTURE_HOLD_FRAMES = 8;
export const GESTURE_COOLDOWN_MS = 1200;

// Dwell-to-click: hover cursor on a control for this long to activate.
// Easier on stage than a precise pinch on a moving target.
export const DWELL_CLICK_MS = 700;

// Frames of lost tracking tolerated before committing the open stroke.
// Long enough (~1s at 30fps) to ride out brief detection dropouts while
// drawing fast or when the hand briefly occludes itself.
export const HAND_LOST_GRACE_FRAMES = 30;

// Extra pixels added around every virtual button for hit-testing
export const BUTTON_HIT_PAD = 30;

export const MODEL_URL =
  'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task';
export const WASM_BASE =
  'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@latest/wasm';

export const INK = '#1a1a2e';
export const STROKE_WIDTH = 5;

// Palette for the on-stage color picker (INK first = default).
// No white — canvas is white, stroke would vanish.
export const COLORS = [
  INK,
  '#e63946', // red
  '#f77f00', // orange
  '#fcbf49', // yellow
  '#2a9d34', // green
  '#1d6fe0', // blue
  '#7b2cbf', // purple
  '#f72585', // pink
];

// MediaPipe hand landmark indices
export const INDEX_TIP = 8;
export const THUMB_TIP = 4;
