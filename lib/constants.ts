// Hand landmarks do not need HD camera input. 480x360 cuts MediaPipe input
// work while the drawing canvas stays full-res.
export const CAMERA = { width: 480, height: 360 };

// One-Euro Filter (pixel space). mincutoff = stillness: lower = steadier at
// rest. beta = speed responsiveness: higher = less lag on fast sweeps.
// 0.5/0.04 = pen feel: heavy jitter kill at rest, and the adaptive cutoff
// stays LOW during motion so hand tremor is smoothed out of strokes.
// Previously beta was 0.12 — cutoff spiked during movement and the filter
// passed tremor straight through, making strokes shaky.
// Tuned against post-calibration MediaPipe jitter (±6 px), not idealized
// sub-pixel noise. The lower beta keeps a resting pen physically planted;
// deliberate fast strokes still remain below the 20 px lag budget.
export const ONE_EURO_MIN_CUTOFF = 0.3;
export const ONE_EURO_BETA = 0.015;
export const ONE_EURO_D_CUTOFF = 1.0;

// Minimum cursor travel before a point joins the live stroke. Swallows the
// ~1-2px of residual tracking jitter so a held hand draws no wiggle — like
// a real pen whose tip doesn't slide while the hand holds position.
// Keep tiny camera jitter out, but retain small bends so freehand strokes feel
// like ink instead of long straight chords between sparse points.
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

// Multi-finger gestures use a short time-based hold so their latency remains
// stable even if CV frame rate dips. 5 = open the command wheel.
export const GESTURE_HOLD_MS = 160;

// Dwell-to-select: aiming at a menu node for this long activates it — no
// pinch required. Long enough that sweeping past a node never fires; short
// enough to feel responsive on stage.
export const DWELL_SELECT_MS = 900;

// Frames of lost tracking tolerated before committing the open stroke.
// Long enough (~1s at 30fps) to ride out brief detection dropouts while
// drawing fast or when the hand briefly occludes itself.
export const HAND_LOST_GRACE_FRAMES = 30;

// A short tracking dropout may resume the same stroke, but never bridge a
// large re-acquisition jump with a diagonal line across the canvas.
export const MAX_REACQUIRE_JUMP_PX = 80;

// Extra pixels added around every virtual button for hit-testing
export const BUTTON_HIT_PAD = 10;

export const MODEL_URL =
  'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task';
export const WASM_BASE =
  'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@1.0.1/wasm';

export const INK = '#1a1a2e';
export const STROKE_WIDTH = 6;
export const MIN_BRUSH_SIZE = 2;
export const MAX_BRUSH_SIZE = 24;

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
