// Files moving between the cloud and ~/nimbytes (mock M3 "Transfers"): arrow, name and kind, a
// progress bar, and "4.1/10 MB" or "Done". Used by the Sync page and the Mac Upload page.
import type { TransferRow } from '../../core/desktop-sync';
import './TransferList.css';

/**
 * The list.
 * @param props - The formatted rows and the line to show when there are none.
 * @returns The list, or the empty line.
 */
export function TransferList({ rows, empty }: { rows: readonly TransferRow[]; empty: string }) {
  if (rows.length === 0) return <span className="transfer-list__muted">{empty}</span>;
  return (
    <ul className="transfer-list">
      {rows.map((row) => (
        <li key={row.id} className="transfer-list__row">
          <span className="transfer-list__name">
            {`${row.arrow} ${row.name} `}
            <span className="transfer-list__muted">{`· ${row.kind}`}</span>
          </span>
          <span
            className="transfer-list__bar"
            role="progressbar"
            aria-label={row.name}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={row.percent}
          >
            <span
              className={row.isDone ? 'transfer-list__fill transfer-list__fill--done' : 'transfer-list__fill'}
              style={{ width: `${String(row.percent)}%` }}
            />
          </span>
          <span className="transfer-list__value">{row.progress}</span>
        </li>
      ))}
    </ul>
  );
}
