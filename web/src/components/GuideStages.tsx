// The "Making a guide" progress list (V33's right column): one row per stage with a dot (green
// done, accent pulsing now, grey next), the stage in words and the model doing it. iRead draws its
// "Pages → Read → Voice" list with the same `StageList`.
import { stageRows, type StageState } from '../core/guides';
import type { GuideStage, GuideStatus } from '../services/api/types';
import './GuideStages.css';

/** One row of a progress list. */
export interface StageListRow {
  id: string;
  label: string;
  /** The model or tool doing it ("" for none). */
  model: string;
  state: StageState;
}

/**
 * Any progress list.
 * @param props - Its rows, in order.
 * @returns The ordered list.
 */
export function StageList({ rows }: { rows: readonly StageListRow[] }) {
  return (
    <ol className="guide-stages" aria-label="Progress">
      {rows.map((row) => (
        <li key={row.id} className={`guide-stages__row guide-stages__row--${row.state}`} aria-current={row.state === 'now' ? 'step' : undefined}>
          <span className="guide-stages__dot" aria-hidden="true" />
          <span className="guide-stages__label">{row.label}</span>
          <span className="guide-stages__model">{row.model}</span>
        </li>
      ))}
    </ol>
  );
}

/** Props for `GuideStages`. */
export interface GuideStagesProps {
  status: GuideStatus;
  stage: GuideStage | null;
}

/**
 * The guide's list.
 * @param props - See `GuideStagesProps`.
 * @returns The ordered list.
 */
export function GuideStages({ status, stage }: GuideStagesProps) {
  return <StageList rows={stageRows(status, stage).map((row) => ({ ...row, id: row.stage }))} />;
}
