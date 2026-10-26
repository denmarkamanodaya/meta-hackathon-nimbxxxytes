// Reads device facts for the install hint and a dismissed flag in localStorage (wrapped:
// storage may throw; then the hint simply shows again next time).
import type { DeviceInfo } from '../core/install-hint';

const DISMISSED_KEY = 'nimbytes.installHintDismissed';

/**
 * Reads the device facts from the browser.
 * @returns User agent, touch points and whether the app runs installed.
 */
export function readDevice(): DeviceInfo {
  const iosStandalone = 'standalone' in navigator && navigator.standalone === true;
  return {
    userAgent: navigator.userAgent,
    maxTouchPoints: navigator.maxTouchPoints,
    isStandalone: iosStandalone || window.matchMedia('(display-mode: standalone)').matches,
  };
}

/** Remembers that the user closed the install hint. Never throws. */
export interface InstallHintStore {
  isDismissed: () => boolean;
  dismiss: () => void;
}

/**
 * Builds the store over a `Storage`.
 * @param storage - `localStorage`, or null when denied.
 * @returns The store.
 */
export function createInstallHintStore(storage: Storage | null): InstallHintStore {
  return {
    isDismissed: () => {
      try {
        return storage?.getItem(DISMISSED_KEY) === '1';
      } catch {
        return false; // Recovers: the hint shows again, which is harmless.
      }
    },
    dismiss: () => {
      try {
        storage?.setItem(DISMISSED_KEY, '1');
      } catch {
        // Recovers: dismissal lasts for this page only.
      }
    },
  };
}
