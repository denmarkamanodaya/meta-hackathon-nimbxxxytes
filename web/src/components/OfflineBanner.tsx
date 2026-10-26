// Thin banner at the top while the device is offline.
import { Icon } from '../design/Icon';
import { useOnline } from '../hooks/useAppChrome';
import './OfflineBanner.css';

/**
 * Says the app is offline and what still works; renders nothing when online.
 * @returns The banner or null.
 */
export function OfflineBanner() {
  if (useOnline()) return null;
  return (
    <div className="offline-banner" role="status">
      <Icon name="offline" />
      You are offline. Uploads resume when you are back.
    </div>
  );
}
