// The critique's five scores as bars, with the total and the verdict.
import { Chip } from '../design/Chip';
import { CRITIQUE_DIMENSIONS, type Critique, type CritiqueDimension } from '../services/api/types';
import './ScoreBars.css';

const LABEL: Record<CritiqueDimension, string> = {
  hook: 'Hook',
  pacing: 'Pacing',
  continuity: 'Continuity',
  captions: 'Captions',
  length: 'Length',
};

/** Props for `ScoreBars`. */
export interface ScoreBarsProps {
  critique: Critique;
}

/**
 * Five labelled 0–10 bars; the total is out of 50.
 * @param props - See `ScoreBarsProps`.
 * @returns The score block.
 */
export function ScoreBars({ critique }: ScoreBarsProps) {
  return (
    <div className="score-bars">
      <div className="score-bars__head">
        <span className="score-bars__total">
          {critique.total}
          <span className="score-bars__max">/50</span>
        </span>
        <Chip tone={critique.verdict === 'accept' ? 'success' : 'accent'}>
          {critique.verdict === 'accept' ? 'Accepted' : 'Needs a revision'}
        </Chip>
      </div>
      <dl className="score-bars__list">
        {CRITIQUE_DIMENSIONS.map((dimension) => {
          const score = critique.scores[dimension];
          return (
            <div key={dimension} className="score-bars__row">
              <dt className="score-bars__label">{LABEL[dimension]}</dt>
              <dd className="score-bars__value">
                <span className="score-bars__track" aria-hidden="true">
                  <span className="score-bars__fill" style={{ width: `${String(score * 10)}%` }} />
                </span>
                <span className="score-bars__number">{score}</span>
              </dd>
            </div>
          );
        })}
      </dl>
    </div>
  );
}
