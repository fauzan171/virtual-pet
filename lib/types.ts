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

export interface Stroke {
  points: Point[];
  width: number;
  color: string;
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
}

export type ButtonId = 'UNDO' | 'CLEAR' | 'GENERATE';
