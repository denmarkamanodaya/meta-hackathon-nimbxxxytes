import { describe, expect, it } from 'vitest';
import { createInstallHintStore } from './device';

describe('createInstallHintStore', () => {
  it('remembers a dismissal', () => {
    localStorage.clear();
    const store = createInstallHintStore(localStorage);

    expect(store.isDismissed()).toBe(false);
    store.dismiss();
    expect(createInstallHintStore(localStorage).isDismissed()).toBe(true);
  });

  it('never throws when storage is blocked', () => {
    const blocked = {
      getItem: () => {
        throw new Error('SecurityError');
      },
      setItem: () => {
        throw new Error('QuotaExceededError');
      },
    } as unknown as Storage;
    const store = createInstallHintStore(blocked);

    expect(store.isDismissed()).toBe(false);
    expect(() => {
      store.dismiss();
    }).not.toThrow();
  });
});
