// The draft score block (Mist): "Draft 1 → Draft N" totals out of 50, the accepted pill, and
// five score bars with a tick at the previous draft's score and a mono "a→b".
import { SCORE_MAX, scoreRows } from '../core/agent-trail';
import { Icon } from '../design/Icon';
import type { ShortVersion } from '../services/api/types';
import './DraftScoreCard.css';

/** Props for `DraftScoreCard`. */
export interface DraftScoreCardProps {
  shown: ShortVersion;
  /** The first draft, when the shown draft is a later one. */
  first: ShortVersion | null;
  /** The draft the shown one revised (its scores are the ticks). */
  previous: ShortVersion | null;
}

function Total({ version, isBest }: { version: ShortVersion; isBest: boolean }) {
  return (
    <span className={isBest ? 'draft-scores__total draft-scores__total--best' : 'draft-scores__total'}>
      <span className="draft-scores__draft">{`Draft ${String(version.n)}`}</span>
      <span className="draft-scores__number">
        {version.score_total ?? '—'}
        <span className="draft-scores__max">{`/${String(SCORE_MAX)}`}</span>
      </span>
    </span>
  );
}

/**
 * The card.
 * @param props - See `DraftScoreCardProps`.
 * @returns The scores column.
 */
export function DraftScoreCard({ shown, first, previous }: DraftScoreCardProps) {
  const critique = shown.critique;
  const rows = critique === null ? [] : scoreRows(critique, previous?.critique ?? null);
  return (
    <div className="draft-scores">
      <div className="draft-scores__card">
        {first !== null && (
          <>
            <Total version={first} isBest={false} />
            <Icon name="arrow" size="sm" />
          </>
        )}
        <Total version={shown} isBest={first !== null} />
      </div>
      {critique?.verdict === 'accept' && (
        <span className="draft-scores__accepted">
          <Icon name="check" size="xs" />
          {`Editor accepts draft ${String(shown.n)}`}
        </span>
      )}
      {critique === null ? (
        <p className="draft-scores__muted">Not critiqued yet</p>
      ) : (
        <dl className="draft-scores__bars">
          {rows.map((row) => (
            <div key={row.dimension} className="draft-scores__bar">
              <dt>{row.label}</dt>
              <dd className="draft-scores__track" aria-label={`${row.label} ${String(row.score)} of 10`}>
                <span className="draft-scores__fill" style={{ width: `${String(row.score * 10)}%` }} />
                {row.previous !== null && (
                  <span className="draft-scores__tick" style={{ left: `${String(row.previous * 10)}%` }} />
                )}
              </dd>
              <dd className="draft-scores__value">
                {row.previous === null ? row.score : `${String(row.previous)}→${String(row.score)}`}
              </dd>
            </div>
          ))}
        </dl>
      )}
    </div>
  );
}
