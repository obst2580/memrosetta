/**
 * Start a high-resolution timer. Returns a function that,
 * when called, returns the elapsed time in milliseconds.
 */
export function startTimer(): () => number {
  const start = performance.now();
  return () => performance.now() - start;
}
