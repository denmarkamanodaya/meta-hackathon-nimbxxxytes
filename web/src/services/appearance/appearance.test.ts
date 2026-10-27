import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createAppearanceStore, createDocumentAppearance, type DarkModeQuery } from './appearance';

const blocked = {
  getItem: () => {
    throw new Error('SecurityError');
  },
  setItem: () => {
    throw new Error('QuotaExceededError');
  },
} as unknown as Storage;

/** A controllable `(prefers-color-scheme: dark)`. */
function fakeDarkMode(matches: boolean) {
  let onChange: (() => void) | null = null;
  const query: DarkModeQuery & { flip: (next: boolean) => void } = {
    matches,
    addEventListener: (_type, listener) => {
      onChange = listener;
    },
    flip: (next) => {
      (query as { matches: boolean }).matches = next;
      onChange?.();
    },
  };
  return query;
}

beforeEach(() => {
  localStorage.clear();
});

describe('createAppearanceStore', () => {
  it('defaults to light when nothing is stored', () => {
    expect(createAppearanceStore(localStorage).read()).toBe('light');
  });

  it('remembers the choice across instances (a relaunch)', () => {
    createAppearanceStore(localStorage).write('dark');

    expect(localStorage.getItem('nimbytes.appearance')).toBe('dark');
    expect(createAppearanceStore(localStorage).read()).toBe('dark');
  });

  it('reads an unknown stored value as light', () => {
    localStorage.setItem('nimbytes.appearance', 'sepia');

    expect(createAppearanceStore(localStorage).read()).toBe('light');
  });

  it('falls back to light and never throws when storage is blocked or missing', () => {
    for (const storage of [blocked, null]) {
      const store = createAppearanceStore(storage);
      expect(store.read()).toBe('light');
      expect(() => {
        store.write('dark');
      }).not.toThrow();
    }
  });
});

describe('createDocumentAppearance', () => {
  const setup = (stored: string | null, isSystemDark: boolean) => {
    if (stored !== null) localStorage.setItem('nimbytes.appearance', stored);
    const root = document.createElement('html');
    const darkMode = fakeDarkMode(isSystemDark);
    const events = new EventTarget() as EventTarget & Window;
    const control = createDocumentAppearance({
      store: createAppearanceStore(localStorage),
      darkMode,
      root,
      events,
    });
    return { root, darkMode, events, control };
  };

  it('draws the stored choice at start, following macOS when it is System', () => {
    expect(setup('system', true).root.dataset.theme).toBe('dark');
    localStorage.clear();
    expect(setup('system', false).root.dataset.theme).toBe('light');
    localStorage.clear();
    expect(setup('light', true).root.dataset.theme).toBe('light');
    localStorage.clear();
    expect(setup('dark', false).root.dataset.theme).toBe('dark');
  });

  it('opens light when nothing is stored, even when macOS is dark', () => {
    const { root, control } = setup(null, true);

    expect(root.dataset.theme).toBe('light');
    expect(control.get()).toBe('light');
  });

  it('switches live, stores the choice and tells subscribers', () => {
    const { root, control } = setup(null, false);
    const listener = vi.fn();
    control.subscribe(listener);

    control.set('dark');

    expect(root.dataset.theme).toBe('dark');
    expect(control.get()).toBe('dark');
    expect(localStorage.getItem('nimbytes.appearance')).toBe('dark');
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('follows a macOS change only while the choice is System', () => {
    const { root, darkMode, control } = setup('system', false);

    darkMode.flip(true);
    expect(root.dataset.theme).toBe('dark');

    control.set('light');
    const listener = vi.fn();
    control.subscribe(listener);
    darkMode.flip(false);
    darkMode.flip(true);
    expect(root.dataset.theme).toBe('light');
    expect(listener).not.toHaveBeenCalled();
  });

  it('picks up a change another window stored', () => {
    const { root, events, control } = setup(null, false);
    const listener = vi.fn();
    control.subscribe(listener);

    events.dispatchEvent(new StorageEvent('storage', { key: 'other', newValue: 'dark' }));
    expect(listener).not.toHaveBeenCalled();

    events.dispatchEvent(new StorageEvent('storage', { key: 'nimbytes.appearance', newValue: 'dark' }));
    expect(root.dataset.theme).toBe('dark');
    expect(control.get()).toBe('dark');
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('stops notifying after unsubscribe', () => {
    const { control } = setup(null, false);
    const listener = vi.fn();
    const unsubscribe = control.subscribe(listener);

    unsubscribe();
    control.set('dark');

    expect(listener).not.toHaveBeenCalled();
  });

  it('treats System as light when the webview cannot report dark mode', () => {
    const root = document.createElement('html');
    createDocumentAppearance({ store: createAppearanceStore(null), darkMode: null, root, events: null });

    expect(root.dataset.theme).toBe('light');
  });
});
