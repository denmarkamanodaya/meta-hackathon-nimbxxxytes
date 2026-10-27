// Library storage card: how much is in the cloud, how little is on the phone, and the split
// between footage watched lately and resting (cheaper) storage.
import { formatGb, formatGbRounded, tierSplit } from '../core/storage';
import { Skeleton } from '../design/Skeleton';
import { useStorage } from '../hooks/useOverview';
import './StorageCard.css';

/**
 * The card; a skeleton while loading, nothing if storage cannot be read (the clips still show).
 * @returns The section, or null.
 */
export function StorageCard() {
  const state = useStorage();
  if (state.status === 'error') return null;
  if (state.status === 'loading') {
    return (
      <section className="storage-card" aria-label="Storage" aria-busy="true">
        <Skeleton kind="title" />
        <Skeleton kind="line" />
      </section>
    );
  }
  const { cloud_bytes, phone_bytes, frequent_bytes, resting_bytes } = state.data;
  const split = tierSplit(frequent_bytes, resting_bytes);
  return (
    <section className="storage-card" aria-label="Storage">
      <div className="storage-card__totals">
        <div className="storage-card__total">
          <span className="storage-card__label">In your cloud</span>
          <span className="storage-card__value">{formatGb(cloud_bytes)}</span>
        </div>
        <div className="storage-card__total storage-card__total--end">
          <span className="storage-card__label">On this phone</span>
          <span className="storage-card__value storage-card__value--accent">{formatGb(phone_bytes)}</span>
        </div>
      </div>
      <div className="storage-card__bar" aria-hidden="true">
        {split.frequent > 0 && <span className="storage-card__seg storage-card__seg--frequent" style={{ flex: split.frequent }} />}
        {split.resting > 0 && <span className="storage-card__seg storage-card__seg--resting" style={{ flex: split.resting }} />}
      </div>
      <div className="storage-card__legend">
        <span>
          <span className="storage-card__swatch storage-card__swatch--frequent" />
          {`Watched lately ${formatGbRounded(frequent_bytes)}`}
        </span>
        <span>
          <span className="storage-card__swatch storage-card__swatch--resting" />
          {`Resting, cheaper ${formatGbRounded(resting_bytes)}`}
        </span>
      </div>
    </section>
  );
}
