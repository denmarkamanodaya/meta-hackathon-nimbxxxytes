// Port: the Mac app's text size. The adapter stores the size and zooms the window to it; the PWA
// has none (the phone's own text size applies there).

/** Reads and changes the text size; every change zooms the window at once. Never throws. */
export interface TextSizeControl {
  /** The current size; 1 is 100%. */
  get(): number;
  /** Stores a new size and applies it. */
  set(size: number): void;
  /**
   * Calls `listener` after every change.
   * @returns Unsubscribe.
   */
  subscribe(listener: () => void): () => void;
}
