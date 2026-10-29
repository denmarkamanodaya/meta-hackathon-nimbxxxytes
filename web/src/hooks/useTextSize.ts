// The Mac app's text size for Settings › Appearance and the ⌘+ / ⌘− / ⌘0 keys: the size, live,
// and a setter.
import { useCallback, useEffect, useSyncExternalStore } from 'react';
import { DEFAULT_TEXT_SIZE, stepTextSize, textSizeKey } from '../core/text-size';
import type { TextSizeControl } from '../core/ports/text-size';
import { useServices } from './services-context';

/** The setting, or null in the PWA. */
export interface TextSizeSetting {
  size: number;
  setSize: (size: number) => void;
}

const noSubscribe = () => () => undefined;

/**
 * Reads and changes the text size.
 * @returns The setting in the Mac app, null in the PWA.
 */
export function useTextSize(): TextSizeSetting | null {
  const control: TextSizeControl | null = useServices().textSize;
  const subscribe = useCallback((listener: () => void) => (control === null ? noSubscribe() : control.subscribe(listener)), [control]);
  const size = useSyncExternalStore(subscribe, () => control?.get() ?? null);
  const setSize = useCallback(
    (next: number) => {
      control?.set(next);
    },
    [control],
  );
  if (size === null) return null;
  return { size, setSize };
}

/** ⌘ or Ctrl with +, − or 0 anywhere in the window: bigger, smaller, or back to 100%. */
export function useTextSizeKeys(): void {
  const control: TextSizeControl | null = useServices().textSize;
  useEffect(() => {
    if (control === null) return undefined;
    const onKey = (event: KeyboardEvent) => {
      const asked = textSizeKey(event);
      if (asked === null) return;
      event.preventDefault();
      control.set(asked === 'reset' ? DEFAULT_TEXT_SIZE : stepTextSize(control.get(), asked === 'up' ? 1 : -1));
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
    };
  }, [control]);
}
