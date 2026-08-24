export type AppState =
  | 'INITIALIZING'
  | 'CAMERA_PERMISSION'
  | 'READY'
  | 'DRAWING'
  | 'CAPTURE'
  | 'GENERATING'
  | 'RESULT'
  | 'RESET';

export interface Point {
  x: number;
  y: number;
}

export type ShapeId =
  | 'circle'
  | 'square'
  | 'rectangle'
  | 'triangle'
  | 'star'
  | 'heart'
  | 'line'
  | 'arrow'
  | 'curve';

export type ToolId = 'pen' | 'eraser';

export type DrawMode = 'smart' | 'point' | 'pinch';

export type GestureType =
  | 'point'
  | 'pinch'
  | 'peace'
  | 'three'
  | 'open'
  | 'fist'
  | 'hover';

export interface Stroke {
  points: Point[];
  width: number;
  color: string;
  /** When set the stroke is a parametric shape dragged from points[0]. */
  shape?: ShapeId;
  /** Eraser strokes are rendered white (canvas bg) instead of ink. */
  tool?: ToolId;
  /** Optional metadata about auto-recognized shape */
  recognizedAs?: ShapeId;
  /** Optional neon glow styling */
  glow?: boolean;
}

export interface LandmarkPoint {
  x: number;
  y: number;
  z?: number;
}

export interface HandFrame {
  detected: boolean;
  // Smoothed cursor position in canvas pixel coordinates
  cursor: Point;
  // Normalized landmark positions from MediaPipe
  rawIndex: Point;
  rawThumb: Point;
  pinchDist: number;
  // After hysteresis
  pinching: boolean;
  // Index finger extended while others curled (Natural Air Pen mode)
  isPointing: boolean;
  // Gesture: only index + middle extended (two fingers up)
  twoFingers: boolean;
  // 3 fingers extended
  threeFingers: boolean;
  // Open hand (4-5 fingers extended)
  openPalm: boolean;
  // Fist (all curled)
  fist: boolean;
  // Human readable gesture descriptor
  activeGesture: GestureType;
  // How many fingers are extended — INCLUDING the thumb when it is out.
  fingerCount: number;
  thumbOut: boolean;
  // Complete 21 hand landmarks for skeleton preview
  landmarks?: LandmarkPoint[];
}

export interface DetectedShapeResult {
  type: ShapeId;
  confidence: number;
  label: string;
  points: Point[];
}

export type ButtonId = 'UNDO' | 'CLEAR' | 'GENERATE' | 'CLOSE';


