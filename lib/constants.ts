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

export const MODEL_URL =
  'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task';
export const WASM_BASE =
  'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@latest/wasm';

export const INK = '#1a1a2e';
export const STROKE_WIDTH = 5;

// MediaPipe hand landmark indices
export const INDEX_TIP = 8;
export const THUMB_TIP = 4;
