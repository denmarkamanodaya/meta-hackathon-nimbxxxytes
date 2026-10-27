// Settings › AI and cost: what the Meta model calls cost, from the cost ledger (`GET /api/costs`).
// The ledger keeps an all-time total, not a monthly one, so the total row says "So far".
import { costRows } from '../../../core/cost-rows';
import { formatUsd } from '../../../core/format';
import { Skeleton } from '../../../design/Skeleton';
import { useCosts } from '../../../hooks/useAppChrome';
import { SettingsHeading } from './SettingsParts';

/**
 * The section; the costs load when it opens.
 * @returns The section's rows.
 */
export function CostSettings() {
  const state = useCosts();
  return (
    <>
      <SettingsHeading title="AI and cost" lead="Every Meta model call is logged. Repeats are answered from the cache for free." />
      {state.status === 'loading' && (
        <div aria-busy="true">
          <Skeleton kind="line" />
          <Skeleton kind="line-short" />
        </div>
      )}
      {state.status === 'error' && <p className="mac-set__hint">{`Cost not available: ${state.message}`}</p>}
      {state.status === 'ready' && (
        <>
          <div className="mac-set__split mac-set__line">
            <span className="mac-set__row-title">So far</span>
            <span>{formatUsd(state.data.total_usd)}</span>
          </div>
          {costRows(state.data).map((row) => (
            <div key={row.label} className="mac-set__split mac-set__line mac-set__line--small">
              <span className="mac-set__secondary">{row.label}</span>
              <span>{formatUsd(row.costUsd)}</span>
            </div>
          ))}
        </>
      )}
    </>
  );
}
