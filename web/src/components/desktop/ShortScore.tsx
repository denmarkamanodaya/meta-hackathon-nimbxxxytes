// Mac Short page score row under the Player (mock M2): "Draft 1 25/50 → Draft 2 43/50" and the
// Accepted pill once the editor accepts the shown draft.
import type { ShortVersion } from '../../services/api/types';
import './ShortScore.css';

function Total({ version, isBest }: { version: ShortVersion; isBest: boolean }) {
  return (
    <>
      {`Draft ${String(version.n)} `}
      <span className={isBest ? 'short-score__number short-score__number--best' : 'short-score__number'}>
        {`${version.score_total === null ? '—' : String(version.score_total)}/50`}
      </span>
    </>
  );
}

/**
 * The row.
 * @param props - The shown draft and the first draft (null when the shown one is the first).
 * @returns The row.
 */
export function ShortScore({ shown, first }: { shown: ShortVersion; first: ShortVersion | null }) {
  return (
    <div className="short-score">
      <span className="short-score__line">
        {first !== null && (
          <>
            <Total version={first} isBest={false} />
            {' → '}
          </>
        )}
        <Total version={shown} isBest={first !== null} />
      </span>
      {shown.critique?.verdict === 'accept' && <span className="short-score__accepted">Accepted</span>}
    </div>
  );
}
