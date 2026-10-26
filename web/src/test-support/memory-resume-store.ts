// In-memory ResumeStore for use-case tests. Stores deep copies so a test sees what was saved,
// not a live reference the code under test keeps mutating.
import type { ResumeState, ResumeStore } from '../services/upload/resume-store';

/** A `ResumeStore` backed by a Map, plus the Map for assertions. */
export function createMemoryResumeStore(initial: Record<string, ResumeState> = {}) {
  const entries = new Map<string, ResumeState>(
    Object.entries(initial).map(([key, state]) => [key, structuredClone(state)]),
  );
  const store: ResumeStore = {
    load: (key) => Promise.resolve(structuredClone(entries.get(key) ?? null)),
    save: (key, state) => {
      entries.set(key, structuredClone(state));
      return Promise.resolve();
    },
    remove: (key) => {
      entries.delete(key);
      return Promise.resolve();
    },
  };
  return { store, entries };
}
