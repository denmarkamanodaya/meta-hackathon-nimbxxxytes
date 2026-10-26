// Hooks for app-wide chrome: toasts, the offline banner, the iOS install hint, the settings
// sheet's cost report, and sign-out.
import { useCallback, useEffect, useState, useSyncExternalStore } from 'react';
import { shouldShowInstallHint } from '../core/install-hint';
import type { CostReport } from '../services/api/types';
import type { Toast, ToastStore } from '../services/toast/toast-store';
import { usePolled, type Polled } from './usePolled';
import { useServices } from './services-context';

/**
 * The toasts on screen, plus the store to raise or dismiss them.
 * @returns Toast list and store.
 */
export function useToasts(): { toasts: readonly Toast[]; store: ToastStore } {
  const { toasts } = useServices();
  return { toasts: useSyncExternalStore(toasts.subscribe, toasts.getSnapshot), store: toasts };
}

/**
 * Tracks the browser's online state.
 * @returns False while the device reports no network.
 */
export function useOnline(): boolean {
  const [isOnline, setOnline] = useState(() => navigator.onLine);
  useEffect(() => {
    const update = () => {
      setOnline(navigator.onLine);
    };
    window.addEventListener('online', update);
    window.addEventListener('offline', update);
    return () => {
      window.removeEventListener('online', update);
      window.removeEventListener('offline', update);
    };
  }, []);
  return isOnline;
}

/**
 * Whether to show the "Add to Home Screen" hint, and how to dismiss it for good.
 * @returns Visibility and `dismiss`.
 */
export function useInstallHint(): { isVisible: boolean; dismiss: () => void } {
  const { device, installHint } = useServices();
  const [isVisible, setVisible] = useState(() => shouldShowInstallHint(device, installHint.isDismissed()));
  const dismiss = useCallback(() => {
    installHint.dismiss();
    setVisible(false);
  }, [installHint]);
  return { isVisible, dismiss };
}

const once = () => false;

/**
 * Loads the cost report once (mount it only while the settings sheet is open).
 * @returns The report state.
 */
export function useCosts(): Polled<CostReport> {
  const { api } = useServices();
  const load = useCallback((signal: AbortSignal) => api.getCosts(signal), [api]);
  return usePolled(load, { intervalMs: 60_000, keepPolling: once }).state;
}

/**
 * Signs out: the server clears the cookie, the app forgets cached searches and locks.
 * @returns `signOut` and whether it is in progress.
 */
export function useSignOut(): { signOut: () => Promise<void>; isSigningOut: boolean } {
  const { api, session, searchCache, toasts } = useServices();
  const [isSigningOut, setSigningOut] = useState(false);
  const signOut = useCallback(async () => {
    setSigningOut(true);
    try {
      await api.signOut();
      searchCache.clear();
      session.lock();
    } catch (error) {
      toasts.error('Could not sign out', error);
    } finally {
      setSigningOut(false);
    }
  }, [api, session, searchCache, toasts]);
  return { signOut, isSigningOut };
}
