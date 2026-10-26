// Live log of the editing agent: one row per step, the newest running step animated.
import { agentStepLabel } from '../core/agent-trail';
import { Icon } from '../design/Icon';
import { Spinner } from '../design/Spinner';
import type { AgentStep } from '../services/api/types';
import './AgentSteps.css';

/** Props for `AgentSteps`. */
export interface AgentStepsProps {
  steps: readonly AgentStep[];
  /** True while the agent still runs: the last step shows a spinner. */
  isWorking: boolean;
}

/**
 * Ordered step list; results are folded under their call, so the list reads as a story.
 * @param props - See `AgentStepsProps`.
 * @returns The list, announced politely as it grows.
 */
export function AgentSteps({ steps, isWorking }: AgentStepsProps) {
  const visible = steps.filter((step) => step.kind !== 'tool_result');
  return (
    <ol className="agent-steps" aria-live="polite">
      {visible.map((step, index) => {
        const isCurrent = isWorking && index === visible.length - 1;
        return (
          <li key={step.seq} className={`agent-steps__step${isCurrent ? ' agent-steps__step--current' : ''}`}>
            <span className="agent-steps__marker" aria-hidden="true">
              {isCurrent ? <Spinner /> : <Icon name="check" />}
            </span>
            <span className="agent-steps__text">
              <span className="agent-steps__label">{agentStepLabel(step)}</span>
              {step.summary !== '' && <span className="agent-steps__summary">{step.summary}</span>}
            </span>
          </li>
        );
      })}
    </ol>
  );
}
