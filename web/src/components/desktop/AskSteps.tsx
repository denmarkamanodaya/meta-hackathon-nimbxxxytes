// The plan card's numbered steps with their models: ticked when done, a turning ring on the one
// running, the number while it waits; and the bar above them while a job runs. Shared by every Ask
// card.
import type { BarView, RowView } from '../../core/ask/jobs';
import { Icon } from '../../design/Icon';
import { ProgressBar } from '../../design/ProgressBar';
import './AskPlanCard.css';

function Mark({ row, n }: { row: RowView; n: number }) {
  if (row.state === 'done') {
    return (
      <span className="ask-card__mark ask-card__mark--done">
        <Icon name="check" size="xs" />
      </span>
    );
  }
  if (row.state === 'now') return <span className="ask-card__mark ask-card__mark--now" aria-hidden="true" />;
  return <span className="ask-card__mark">{n}</span>;
}

/**
 * The steps.
 * @param props - The rows with their state.
 * @returns The list.
 */
export function AskSteps({ rows }: { rows: readonly RowView[] }) {
  return (
    <ol className="ask-card__steps">
      {rows.map((row, index) => (
        <li key={row.label} className="ask-card__step" data-state={row.state} aria-current={row.state === 'now' ? 'step' : undefined}>
          <Mark row={row} n={index + 1} />
          <span className="ask-card__step-text">
            <span className="ask-card__step-label">{row.label}</span>
            <span className="ask-card__step-detail">{row.detail}</span>
          </span>
          <span className="ask-card__tool">{row.tool}</span>
        </li>
      ))}
    </ol>
  );
}

/**
 * The bar ("Step 2 of 4 · Plan the cut", "38%").
 * @param props - The bar and whether the job is done (green).
 * @returns The bar.
 */
export function AskBar({ bar, isDone }: { bar: BarView; isDone: boolean }) {
  return (
    <div className="ask-card__bar">
      <ProgressBar percent={bar.percent} label={bar.label} tone={isDone ? 'success' : 'accent'} />
      <span className="ask-card__bar-line">
        <span>{bar.label}</span>
        <span className="ask-card__bar-right">{bar.right}</span>
      </span>
    </div>
  );
}
