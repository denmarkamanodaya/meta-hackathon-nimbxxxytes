// One-time hint for iOS Safari, which has no install prompt: Share → Add to Home Screen.
import { Icon } from '../design/Icon';
import { useInstallHint } from '../hooks/useAppChrome';
import './InstallHint.css';

/**
 * Dismissible card; shown only on iOS in the browser until dismissed once.
 * @returns The card or null.
 */
export function InstallHint() {
  const { isVisible, dismiss } = useInstallHint();
  if (!isVisible) return null;
  return (
    <aside className="install-hint" aria-label="Install nimbytes">
      <span className="install-hint__icon">
        <Icon name="cloud" />
      </span>
      <p className="install-hint__text">
        <strong>Install nimbytes.</strong> Tap <Icon name="share" /> Share, then{' '}
        <strong>Add to Home Screen</strong> for full screen and steadier uploads.
      </p>
      <button type="button" className="install-hint__close" aria-label="Dismiss" onClick={dismiss}>
        <Icon name="close" />
      </button>
    </aside>
  );
}
