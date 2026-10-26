import { act, useEffect } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { fakeApi, fakeServices, mount, type Mounted } from '../test-support/services';
import { ApiError, type ApiClient } from '../services/api/client';
import { createInstallHintStore } from '../services/device';
import { createSearchCache } from '../services/search/search-cache';
import { createSessionStore } from '../services/session/session-store';
import { useCosts, useInstallHint, useOnline, useSignOut } from './useAppChrome';
import { useCreateShort } from './useEditor';

let view: Mounted | null = null;
afterEach(() => {
  view?.unmount();
  view = null;
});

const iphone = { userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)', maxTouchPoints: 5, isStandalone: false };

describe('useInstallHint', () => {
  function Probe() {
    const { isVisible, dismiss } = useInstallHint();
    return (
      <button type="button" onClick={dismiss}>
        {String(isVisible)}
      </button>
    );
  }

  it('shows on iOS Safari and stays dismissed after closing', async () => {
    localStorage.clear();
    const installHint = createInstallHintStore(localStorage);
    view = await mount(<Probe />, fakeServices({ device: iphone, installHint }));
    expect(view.container.textContent).toBe('true');

    act(() => {
      view?.container.querySelector('button')?.click();
    });
    expect(view.container.textContent).toBe('false');

    view.unmount();
    view = await mount(<Probe />, fakeServices({ device: iphone, installHint: createInstallHintStore(localStorage) }));
    expect(view.container.textContent).toBe('false');
  });
});

describe('useOnline', () => {
  it('follows the browser offline and online events', async () => {
    function Probe() {
      return <output>{String(useOnline())}</output>;
    }
    const onLine = vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(true);
    view = await mount(<Probe />, fakeServices());

    onLine.mockReturnValue(false);
    act(() => {
      window.dispatchEvent(new Event('offline'));
    });
    expect(view.container.textContent).toBe('false');

    onLine.mockReturnValue(true);
    act(() => {
      window.dispatchEvent(new Event('online'));
    });
    expect(view.container.textContent).toBe('true');
    onLine.mockRestore();
  });
});

describe('useCosts', () => {
  it('loads the cost report once', async () => {
    const getCosts = vi
      .fn<ApiClient['getCosts']>()
      .mockResolvedValue({ total_usd: 0.084, by_model: [{ model: 'muse-spark-1.3', calls: 12, cost_usd: 0.08 }] });
    function Probe() {
      const state = useCosts();
      return <output>{state.status === 'ready' ? String(state.data.total_usd) : state.status}</output>;
    }

    view = await mount(<Probe />, fakeServices({ api: fakeApi({ getCosts }) }));

    expect(view.container.textContent).toBe('0.084');
    expect(getCosts).toHaveBeenCalledTimes(1);
  });
});

describe('useSignOut', () => {
  const handle: { signOut: (() => Promise<void>) | null } = { signOut: null };
  function Probe() {
    const { signOut } = useSignOut();
    useEffect(() => {
      handle.signOut = signOut;
    });
    return null;
  }

  it('asks the server to clear the cookie, forgets cached searches and locks the app', async () => {
    const signOut = vi.fn<ApiClient['signOut']>().mockResolvedValue(true);
    const session = createSessionStore();
    session.unlock();
    const searchCache = createSearchCache(5);
    searchCache.set('beach', { rewritten: { keywords: [], filters: { people: [], speakers: [], place: null, from: null, to: null, min_quality: null } }, results: [], reranked: true });
    view = await mount(<Probe />, fakeServices({ api: fakeApi({ signOut }), session, searchCache }));

    await act(async () => {
      await handle.signOut?.();
    });

    expect(signOut).toHaveBeenCalledTimes(1);
    expect(searchCache.get('beach')).toBeUndefined();
    expect(session.getSnapshot()).toBe('locked');
  });

  it('stays signed in and raises a toast when the server call fails', async () => {
    const signOut = vi.fn<ApiClient['signOut']>().mockRejectedValue(new ApiError('NETWORK_ERROR', 'offline', null));
    const services = fakeServices({ api: fakeApi({ signOut }) });
    services.session.unlock();
    view = await mount(<Probe />, services);

    await act(async () => {
      await handle.signOut?.();
    });

    expect(services.session.getSnapshot()).toBe('active');
    expect(services.toasts.getSnapshot()[0]).toMatchObject({ title: 'Could not sign out', code: 'NETWORK_ERROR' });
  });
});

describe('error toasts from actions', () => {
  it('shows the code and a short message when the editor cannot start', async () => {
    const createShort = vi
      .fn<ApiClient['createShort']>()
      .mockRejectedValue(new ApiError('TIMEOUT', 'slow', null));
    const services = fakeServices({ api: fakeApi({ createShort }) });
    const handle: { create: ReturnType<typeof useCreateShort>['create'] | null } = { create: null };
    function Probe() {
      const { create } = useCreateShort();
      useEffect(() => {
        handle.create = create;
      });
      return null;
    }
    view = await mount(<Probe />, services);

    await act(async () => {
      await handle.create?.({ prompt: 'p', segment_ids: ['s1'], aspect: '4:5', target_s: 15 });
    });

    expect(services.toasts.getSnapshot()).toEqual([
      { id: 1, tone: 'error', title: 'Could not start the editor', text: 'The server took too long.', code: 'TIMEOUT' },
    ]);
  });
});
