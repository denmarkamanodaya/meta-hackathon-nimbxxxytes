// How many browser tabs a render may use. Remotion refuses a concurrency above the machine's
// core count, so the configured value is capped by it (the 2 vCPU server once failed every
// render with RENDER_CONCURRENCY=3).

/**
 * The concurrency to render with.
 * @param requested - RENDER_CONCURRENCY, an integer >= 1.
 * @param cores - CPU cores the renderer sees.
 * @returns `requested`, capped at `cores`, never below 1.
 */
export function renderConcurrency(requested: number, cores: number): number {
  return Math.max(1, Math.min(requested, cores));
}
