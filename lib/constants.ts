// Camera capture size — 640x480 optimizes MediaPipe JS throughput by ~2.5x 
// while HTML5 Canvas stays native Full HD / Fullscreen.
export const CAMERA = { width: 640, height: 480 };

// One-Euro Filter: MIN_CUTOFF = stillness steady, BETA = zero-lag tracking at speed.
export const ONE_EURO_MIN_CUTOFF = 1.0;
export const ONE_EURO_BETA = 0.045;
export const ONE_EURO_D_CUTOFF = 1.0;

// Pen deadzone: Swallows micro-tracking jitter without delaying initial stroke draw.
export const PEN_DEADZONE_PX = 1.8;

// Center 85% fraction of camera frame mapped to full canvas bounds for easier reach.
export const REGION = 0.85;

// Pinch thresholds normalized by hand-span ratio (wrist -> middle MCP).
export const PINCH_ON = 0.32;
export const PINCH_OFF = 0.42;

// Grace period before line commit on pinch release (~100ms at 30fps).
export const PINCH_RELEASE_GRACE_FRAMES = 3;

export const BUTTON_DEBOUNCE_MS = 250;
export const CLEAR_CONFIRM_TIMEOUT_MS = 2000;

// Multi-finger pose gestures (2 frames hold for snappy response).
export const GESTURE_HOLD_FRAMES = 2;
export const GESTURE_COOLDOWN_MS = 350;

// Dwell-to-click activation time for hover interactions.
export const DWELL_CLICK_MS = 350;

// Tolerance frames when hand momentarily leaves video feed before committing stroke.
export const HAND_LOST_GRACE_FRAMES = 12;

// Extra padding around virtual buttons for reliable hit-testing on stage.
export const BUTTON_HIT_PAD = 40;

export const MODEL_URL =
  'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task';
export const WASM_BASE =
  'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@latest/wasm';

export const INK = '#1a1a2e';
export const STROKE_WIDTH = 6;

export const BRUSH_SIZES = [
  { id: 'fine', size: 3, label: 'Fine (3px)' },
  { id: 'medium', size: 6, label: 'Medium (6px)' },
  { id: 'bold', size: 12, label: 'Bold (12px)' },
  { id: 'marker', size: 22, label: 'Marker (22px)' },
] as const;

export type BrushSizeId = (typeof BRUSH_SIZES)[number]['id'];

export const COLORS = [
  INK,
  '#e63946', // red
  '#f77f00', // orange
  '#fcbf49', // yellow
  '#2a9d34', // green
  '#1d6fe0', // blue
  '#7b2cbf', // purple
  '#f72585', // pink
  '#00f0ff', // electric cyan
  '#39ff14', // neon lime
];


// Complete MediaPipe Landmark indices
export const WRIST = 0;
export const THUMB_CMC = 1;
export const THUMB_MCP = 2;
export const THUMB_IP = 3;
export const THUMB_TIP = 4;

export const INDEX_MCP = 5;
export const INDEX_PIP = 6;
export const INDEX_DIP = 7;
export const INDEX_TIP = 8;

export const MIDDLE_MCP = 9;
export const MIDDLE_PIP = 10;
export const MIDDLE_DIP = 11;
export const MIDDLE_TIP = 12;

export const RING_MCP = 13;
export const RING_PIP = 14;
export const RING_DIP = 15;
export const RING_TIP = 16;

export const PINKY_MCP = 17;
export const PINKY_PIP = 18;
export const PINKY_DIP = 19;
export const PINKY_TIP = 20;