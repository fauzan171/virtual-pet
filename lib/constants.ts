export const CAMERA = { width: 1280, height: 720 };

// Exponential smoothing factor for cursor position (0-1, higher = snappier)
export const SMOOTHING = 0.35;

// Center fraction of camera frame mapped to full canvas
export const REGION = 0.75;

// Normalized landmark distance thresholds for pinch detection (hysteresis)
export const PINCH_ON = 0.055;
export const PINCH_OFF = 0.075;

export const BUTTON_DEBOUNCE_MS = 500;
export const CLEAR_CONFIRM_TIMEOUT_MS = 3000;

// Dwell-to-click: hover cursor on a control for this long to activate.
// Easier on stage than a precise pinch on a moving target.
export const DWELL_CLICK_MS = 700;

// Frames of lost tracking tolerated before committing the open stroke.
// Prevents mode flicker when detection drops for a frame or two.
export const HAND_LOST_GRACE_FRAMES = 15;

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
