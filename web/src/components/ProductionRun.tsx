// A production's run state, on the phone and the Mac production pages: the live plan progress
// while the planner runs (storyboards drawn so far), and a stopped plan with why and Retry.
import { PRODUCTION_COPY } from '../core/copy';
import { planProgress } from '../core/production-view';
import { Button } from '../design/Button';
import { ProgressBar } from '../design/ProgressBar';
import { Spinner } from '../design/Spinner';
import type { StudioStepEvent } from '../services/api/types';
import './ProductionRun.css';

/**
 * The live plan progress.
 * @param props - The run's latest step event, or null before the first one.
 * @returns The card.
 */
export function PlanProgress({ event }: { event: StudioStepEvent | null }) {
  const progress = planProgress(event ?? { step: 'planning', status: 'running' });
  return (
    <section className="plan-progress" aria-label="Planning">
      <p className="plan-progress__line" role="status">
        <Spinner />
        {progress.label}
      </p>
      {progress.fraction !== null && <ProgressBar percent={Math.round(progress.fraction * 100)} label="Storyboards drawn" />}
    </section>
  );
}

/**
 * A stopped plan: why, and Retry.
 * @param props - The server's reason (or null) and the retry action.
 * @returns The alert.
 */
export function PlanStopped({ error, onRetry }: { error: string | null; onRetry: () => void }) {
  return (
    <section className="plan-stopped" role="alert">
      <p className="plan-stopped__title">{PRODUCTION_COPY.planFailed}</p>
      {error !== null && <p className="plan-stopped__why">{error}</p>}
      <Button variant="secondary" onClick={onRetry}>
        {PRODUCTION_COPY.retry}
      </Button>
    </section>
  );
}
