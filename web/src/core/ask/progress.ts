// How far a running Ask job is, from the real signals: a short's status and agent steps, a
// guide's stage. The answer is how many of the card's rows are done (the row after them runs).
import type { AgentStep, GuideStage, GuideStatus, ShortStatus } from '../../services/api/types';
import { SCORE_MAX } from '../agent-trail';
import { stageRows } from '../guides';

/** Rows of the short card: find, plan, cut, review. */
export const SHORT_ROWS = 4;
/** Rows of the guide card: steps, frames, circles, voice. */
export const GUIDE_ROWS = 4;

const hasRender = (steps: readonly AgentStep[]) => steps.some((step) => step.kind === 'tool_call' && step.tool === 'render_preview');
const hasCritique = (steps: readonly AgentStep[]) => steps.some((step) => step.kind === 'critique');
const hasFinal = (steps: readonly AgentStep[]) => steps.some((step) => step.kind === 'final');

/**
 * Rows done for a short. Finding the moments is done once the short exists; the plan once a
 * preview renders; the cut once it is critiqued; the review at the final step or Ready. A row
 * never comes undone: a revision renders again but the critique already happened.
 * @param status - The short's status, or null before it exists.
 * @param steps - Its agent step log.
 * @returns 0–`SHORT_ROWS`.
 */
export function shortRowsDone(status: ShortStatus | null, steps: readonly AgentStep[]): number {
  if (status === null) return 0;
  if (status === 'ready' || hasFinal(steps)) return 4;
  if (hasCritique(steps) || status === 'critiquing' || status === 'revising') return 3;
  if (hasRender(steps) || status === 'rendering') return 2;
  return 1;
}

/**
 * Rows done for a guide: the stages before the running one (all of them once Ready).
 * @param status - The guide's status.
 * @param stage - The running stage.
 * @returns 0–`GUIDE_ROWS`.
 */
export function guideRowsDone(status: GuideStatus, stage: GuideStage | null): number {
  return stageRows(status, stage)
    .slice(0, GUIDE_ROWS)
    .filter((row) => row.state === 'done').length;
}

/**
 * A short's editor score out of 10, as the card says it ("8/10"): the total's share of
 * `SCORE_MAX`, rounded.
 * @param total - The best draft's total.
 * @returns 0–10.
 */
export const scoreOutOfTen = (total: number): number => Math.max(0, Math.min(10, Math.round((total / SCORE_MAX) * 10)));
