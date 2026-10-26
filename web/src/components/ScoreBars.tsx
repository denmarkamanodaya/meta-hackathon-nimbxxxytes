// The critique's five scores as bars, with the total, the verdict, and on v2+ the change of
// each score since the previous version.
import { formatDelta, type ScoreDeltas } from '../core/agent-trail';
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
  /** Change since the previous version; null on v1. */
  deltas: ScoreDeltas | null;
  /** The version the deltas compare against. */
  previousN: number | null;
}

function Delta({ value, against }: { value: number; against: number | null }) {
  const text = formatDelta(value);
  if (text === '' || against === null) return null;
  const tone = value > 0 ? 'score-bars__delta--up' : 'score-bars__delta--down';
  return (
    <span className={`score-bars__delta ${tone}`} aria-label={`${text} since v${String(against)}`}>
      {text}
    </span>
  );
}

/**
 * Five labelled 0–10 bars; the total is out of 50.
 * @param props - See `ScoreBarsProps`.
 * @returns The score block.
 */
export function ScoreBars({ critique, deltas, previousN }: ScoreBarsProps) {
  return (
    <div className="score-bars">
      <div className="score-bars__head">
        <span className="score-bars__total">
          {critique.total}
          <span className="score-bars__max">/50</span>
          {deltas !== null && <Delta value={deltas.total} against={previousN} />}
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
                <span className="score-bars__delta-slot">
                  {deltas !== null && <Delta value={deltas.scores[dimension]} against={previousN} />}
                </span>
              </dd>
            </div>
          );
        })}
      </dl>
    </div>
  );
}
