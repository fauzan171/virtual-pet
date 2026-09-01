/** Whether a video timestamp represents a frame that has not been processed. */
export function shouldProcessVideoFrame(previousTime: number, currentTime: number): boolean {
  return currentTime > previousTime;
}
