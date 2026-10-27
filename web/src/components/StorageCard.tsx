// Library storage card: how much is in the cloud, how little is on the phone, and one line on why
// (footage plays from the cloud; nothing is kept on the phone).
import { STORAGE_COPY } from '../core/copy';
import { formatGb } from '../core/storage';
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
  const { cloud_bytes, phone_bytes } = state.data;
  return (
    <section className="storage-card" aria-label="Storage">
      <div className="storage-card__totals">
        <div className="storage-card__total">
          <span className="storage-card__label">{STORAGE_COPY.inYourCloud}</span>
          <span className="storage-card__value">{formatGb(cloud_bytes)}</span>
        </div>
        <div className="storage-card__total storage-card__total--end">
          <span className="storage-card__label">{STORAGE_COPY.onThisPhone}</span>
          <span className="storage-card__value storage-card__value--accent">{formatGb(phone_bytes)}</span>
        </div>
      </div>
      <p className="storage-card__line">{STORAGE_COPY.phoneLine}</p>
    </section>
  );
}
