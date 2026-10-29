// The "Making a guide" progress list (V33's right column): one row per stage with a dot (green
// done, accent pulsing now, grey next), the stage in words and the model doing it.
import { stageRows } from '../core/guides';
import type { GuideStage, GuideStatus } from '../services/api/types';
import './GuideStages.css';

/** Props for `GuideStages`. */
export interface GuideStagesProps {
  status: GuideStatus;
  stage: GuideStage | null;
}

/**
 * The list.
 * @param props - See `GuideStagesProps`.
 * @returns The ordered list.
 */
export function GuideStages({ status, stage }: GuideStagesProps) {
  return (
    <ol className="guide-stages" aria-label="Progress">
      {stageRows(status, stage).map((row) => (
        <li key={row.stage} className={`guide-stages__row guide-stages__row--${row.state}`} aria-current={row.state === 'now' ? 'step' : undefined}>
          <span className="guide-stages__dot" aria-hidden="true" />
          <span className="guide-stages__label">{row.label}</span>
          <span className="guide-stages__model">{row.model}</span>
        </li>
      ))}
    </ol>
  );
}
