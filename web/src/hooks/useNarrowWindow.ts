// Whether the Mac window is narrow (under 1200 px): the Gallery list then leaves out Recorded and
// Size. Follows the window as it is resized.
import { useSyncExternalStore } from 'react';

/** The width below which a window counts as narrow. */
const NARROW_QUERY = '(max-width: 1199px)';

// Without matchMedia (jsdom in tests) the window counts as wide and never changes.
const hasMatchMedia = () => typeof window.matchMedia === 'function';

const subscribe = (onChange: () => void) => {
  if (!hasMatchMedia()) return () => undefined;
  const query = window.matchMedia(NARROW_QUERY);
  query.addEventListener('change', onChange);
  return () => {
    query.removeEventListener('change', onChange);
  };
};

const isNarrowNow = () => hasMatchMedia() && window.matchMedia(NARROW_QUERY).matches;

/**
 * Whether the window is narrower than 1200 px, updated on resize.
 * @returns True on a narrow window.
 */
export function useNarrowWindow(): boolean {
  return useSyncExternalStore(subscribe, isNarrowNow, () => false);
}
