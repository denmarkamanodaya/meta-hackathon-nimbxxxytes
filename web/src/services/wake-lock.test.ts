import { afterEach, describe, expect, it, vi } from 'vitest';
import { createWakeLockKeeper } from './wake-lock';

/** navigator.wakeLock double whose sentinels the test can release like the browser does. */
function fakeWakeLock() {
  const sentinels: (WakeLockSentinel & { browserRelease: () => void })[] = [];
  const request = vi.fn().mockImplementation(() => {
    const target = new EventTarget();
    const sentinel = Object.assign(target, {
      released: false,
      type: 'screen',
      onrelease: null,
      release: vi.fn(() => {
        sentinel.released = true;
        target.dispatchEvent(new Event('release'));
        return Promise.resolve();
      }),
      browserRelease: () => {
        sentinel.released = true;
        target.dispatchEvent(new Event('release'));
      },
    });
    sentinels.push(sentinel as unknown as WakeLockSentinel & { browserRelease: () => void });
    return Promise.resolve(sentinel);
  });
  return { wakeLock: { request } as unknown as WakeLock, request, sentinels };
}

function setVisibility(state: DocumentVisibilityState) {
  Object.defineProperty(document, 'visibilityState', { value: state, configurable: true });
  document.dispatchEvent(new Event('visibilitychange'));
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

afterEach(() => {
  Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });
});

describe('createWakeLockKeeper', () => {
  it('requests a screen lock when uploads start', async () => {
    const { wakeLock, request } = fakeWakeLock();
    const keeper = createWakeLockKeeper(wakeLock, document);

    keeper.setActive(true);
    await flush();

    expect(request).toHaveBeenCalledWith('screen');
    keeper.dispose();
  });

  it('re-acquires the lock when the page becomes visible again after the browser dropped it', async () => {
    const { wakeLock, request, sentinels } = fakeWakeLock();
    const keeper = createWakeLockKeeper(wakeLock, document);
    keeper.setActive(true);
    await flush();

    setVisibility('hidden');
    sentinels[0]?.browserRelease();
    await flush();
    setVisibility('visible');
    await flush();

    expect(request).toHaveBeenCalledTimes(2);
    keeper.dispose();
  });

  it('does not re-acquire on visibility change once uploads stopped', async () => {
    const { wakeLock, request, sentinels } = fakeWakeLock();
    const keeper = createWakeLockKeeper(wakeLock, document);
    keeper.setActive(true);
    await flush();

    keeper.setActive(false);
    await flush();
    setVisibility('visible');
    await flush();

    expect(sentinels[0]?.released).toBe(true);
    expect(request).toHaveBeenCalledTimes(1);
    keeper.dispose();
  });

  it('does nothing where the API is unsupported', () => {
    const keeper = createWakeLockKeeper(undefined, document);

    expect(() => {
      keeper.setActive(true);
    }).not.toThrow();
    keeper.dispose();
  });

  it('survives a denied request', async () => {
    const request = vi.fn().mockRejectedValue(new DOMException('denied', 'NotAllowedError'));
    const keeper = createWakeLockKeeper({ request }, document);

    keeper.setActive(true);
    await flush();

    expect(request).toHaveBeenCalledTimes(1);
    keeper.dispose();
  });
});
