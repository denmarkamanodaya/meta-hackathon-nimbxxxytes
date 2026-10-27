// Replays a finished short as if the agent were running: steps appear one every `stepMs`, and
// versions, critiques, status and best version follow the steps seen so far.
import type { AgentStep, ShortDetail, ShortStatus } from '../../services/api/types';

function statusAfter(step: AgentStep | undefined): ShortStatus {
  if (step === undefined) return 'planning';
  switch (step.kind) {
    case 'plan':
      return 'planning';
    case 'tool_call':
    case 'tool_result':
      return step.tool === 'critique_preview' ? 'critiquing' : 'rendering';
    case 'critique':
      return 'critiquing';
    case 'revise':
      return 'revising';
    case 'final':
      return 'ready';
  }
}

/**
 * How many steps are visible `elapsedMs` after the run started (the first one at once).
 * @param total - Number of steps.
 * @param elapsedMs - Time since the run started.
 * @param stepMs - Time between steps.
 * @returns 1..total.
 */
export function visibleStepCount(total: number, elapsedMs: number, stepMs: number): number {
  return Math.min(total, Math.floor(Math.max(0, elapsedMs) / stepMs) + 1);
}

/**
 * The short as it would look `elapsedMs` into the run.
 * @param full - The finished short.
 * @param elapsedMs - Time since the run started.
 * @param stepMs - Time between steps.
 * @returns A short with only the steps, versions and critiques reached so far.
 */
export function shortAt(full: ShortDetail, elapsedMs: number, stepMs: number): ShortDetail {
  const steps = full.steps.slice(0, visibleStepCount(full.steps.length, elapsedMs, stepMs));
  const started = (n: number) => steps.some((s) => s.version === n && (s.kind === 'plan' || s.kind === 'revise'));
  const critiqued = (n: number) => steps.some((s) => s.version === n && s.kind === 'critique');
  const last = steps.at(-1);
  const isDone = last?.kind === 'final';
  return {
    ...full,
    short: {
      ...full.short,
      status: statusAfter(last),
      best_version: isDone ? full.short.best_version : null,
    },
    steps,
    versions: full.versions
      .filter((version) => started(version.n))
      .map((version) =>
        critiqued(version.n) ? version : { ...version, critique: null, score_total: null },
      ),
  };
}

/** One SSE event and when to send it. */
export interface ScheduledEvent {
  delayMs: number;
  /** SSE `event:` name; absent for an unnamed event. */
  event?: string;
  data: unknown;
}

/**
 * When to send each step over SSE so the stream matches `shortAt`: past steps at once, the
 * rest at their slot.
 * @param steps - All steps of the run.
 * @param elapsedMs - Time since the run started when the stream opens.
 * @param stepMs - Time between steps.
 * @returns One event per step.
 */
export function stepSchedule(steps: readonly AgentStep[], elapsedMs: number, stepMs: number): ScheduledEvent[] {
  return steps.map((step, index) => ({ delayMs: Math.max(0, index * stepMs - elapsedMs), data: step }));
}
