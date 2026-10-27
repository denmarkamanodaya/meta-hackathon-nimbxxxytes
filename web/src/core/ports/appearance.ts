// Port: the Mac app's appearance setting. The adapter stores the choice and draws the window in
// the theme it resolves to; the PWA has none (it is light only).
import type { Appearance } from '../appearance';

/** Reads and changes the appearance; every change redraws the window at once. Never throws. */
export interface AppearanceControl {
  /** The current choice. */
  get(): Appearance;
  /** Stores a new choice and applies it. */
  set(appearance: Appearance): void;
  /**
   * Calls `listener` after every change (from this window, another window or a stored change).
   * @returns Unsubscribe.
   */
  subscribe(listener: () => void): () => void;
}
