// The storage cap notice, in the PWA and the Mac app alike: nothing while there is room; at 80 %
// and 95 % an amber line with how full and what to do; when full a red line saying uploads can't
// start. Callers that start uploads also read `useStorageCap().isFull` to block them.
import type { CapView } from '../core/storage';
import { Icon } from '../design/Icon';
import './StorageNotice.css';

/**
 * The notice.
 * @param props - The cap view (null while storage loads).
 * @returns The line, or null.
 */
export function StorageNotice({ cap }: { cap: CapView | null }) {
  if (cap?.notice == null) return null;
  return (
    <p className={`storage-notice storage-notice--${cap.tone}`} role={cap.isFull ? 'alert' : 'status'}>
      <Icon name="info" size="xs" />
      {cap.notice}
    </p>
  );
}
