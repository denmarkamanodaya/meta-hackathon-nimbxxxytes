// Library storage strip (P1): one true line, "44.2 GB in your cloud · 0 GB on this phone", and
// why ("Plays from the cloud. Nothing is stored here.").
import { STORAGE_COPY } from '../core/copy';
import { formatGb } from '../core/storage';
import { Icon } from '../design/Icon';
import { Skeleton } from '../design/Skeleton';
import { useStorage } from '../hooks/useOverview';
import './StorageCard.css';

/**
 * The strip; a skeleton line while loading, nothing if storage cannot be read (the clips still show).
 * @returns The section, or null.
 */
export function StorageCard() {
  const state = useStorage();
  if (state.status === 'error') return null;
  if (state.status === 'loading') {
    return (
      <section className="storage-strip" aria-label="Storage" aria-busy="true">
        <Skeleton kind="line" />
      </section>
    );
  }
  const { cloud_bytes, phone_bytes } = state.data;
  return (
    <section className="storage-strip" aria-label="Storage">
      <span className="storage-strip__icon" aria-hidden="true">
        <Icon name="cloud" size="sm" />
      </span>
      <span className="storage-strip__text">
        <span>
          <b>{formatGb(cloud_bytes)}</b> {STORAGE_COPY.inYourCloud.toLowerCase()} · <b>{formatGb(phone_bytes)}</b>{' '}
          {STORAGE_COPY.onThisPhone.toLowerCase()}
        </span>
        <span className="storage-strip__line">{STORAGE_COPY.phoneLine}</span>
      </span>
    </section>
  );
}
