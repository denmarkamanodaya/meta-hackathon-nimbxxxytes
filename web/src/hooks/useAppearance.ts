// The Mac app's appearance setting for the Sync page: the current choice, live, and a setter.
import { useCallback, useSyncExternalStore } from 'react';
import type { Appearance } from '../core/appearance';
import type { AppearanceControl } from '../core/ports/appearance';
import { useServices } from './services-context';

/** The setting, or null in the PWA. */
export interface AppearanceSetting {
  appearance: Appearance;
  setAppearance: (appearance: Appearance) => void;
}

const noSubscribe = () => () => undefined;

/**
 * Reads and changes the appearance.
 * @returns The setting in the Mac app, null in the PWA.
 */
export function useAppearance(): AppearanceSetting | null {
  const control: AppearanceControl | null = useServices().appearance;
  const subscribe = useCallback(
    (listener: () => void) => (control === null ? noSubscribe() : control.subscribe(listener)),
    [control],
  );
  const appearance = useSyncExternalStore(subscribe, () => control?.get() ?? null);
  const setAppearance = useCallback(
    (next: Appearance) => {
      control?.set(next);
    },
    [control],
  );
  if (appearance === null) return null;
  return { appearance, setAppearance };
}
