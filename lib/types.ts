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

export type ShapeId = 'circle' | 'square' | 'triangle' | 'line' | 'curve';

export type ToolId = 'pen' | 'eraser';

export interface Stroke {
  points: Point[];
  width: number;
  color: string;
  /** When set the stroke is a parametric shape dragged from points[0]. */
  shape?: ShapeId;
  /** Eraser strokes are rendered white (canvas bg) instead of ink. */
  tool?: ToolId;
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
  // Gesture: only index + middle extended (two fingers up)
  twoFingers: boolean;
  // How many fingers are extended — INCLUDING the thumb when it is out.
  // During a pinch the thumb tucks, so raised fingers = fingerCount - thumbOut.
  fingerCount: number;
  thumbOut: boolean;
}

export type ButtonId = 'UNDO' | 'CLEAR' | 'GENERATE' | 'CLOSE';
