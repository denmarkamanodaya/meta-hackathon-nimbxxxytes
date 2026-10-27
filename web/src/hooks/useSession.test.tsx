import { act, useEffect } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { fakeApi, fakeServices, mount, type Mounted } from '../test-support/services';
import { ApiError, type ApiClient } from '../services/api/client';
import { ERROR } from '../services/api/types';
import { createSessionStore } from '../services/session/session-store';
import { useSessionCheck, useSessionStatus, useUnlock } from './useSession';

const handle: { submit: ((passcode: string) => Promise<void>) | null } = { submit: null };

function Probe() {
  const status = useSessionStatus();
  const { state, unlock } = useUnlock();
  useEffect(() => {
    handle.submit = unlock;
  });
  return <output>{`${status} ${state.status === 'error' ? state.message : state.status}`}</output>;
}

let view: Mounted | null = null;
afterEach(() => {
  view?.unmount();
  view = null;
});

describe('useUnlock', () => {
  it('posts the passcode and unlocks the session on success', async () => {
    const createSession = vi.fn<ApiClient['createSession']>().mockResolvedValue({ user_id: 'u1' });
    const session = createSessionStore();
    session.lock();
    view = await mount(<Probe />, fakeServices({ api: fakeApi({ createSession }), session }));
    expect(view.container.textContent).toBe('locked idle');

    await act(() => handle.submit?.('let-me-in'));

    expect(createSession).toHaveBeenCalledWith('let-me-in');
    expect(view.container.textContent).toBe('active idle');
  });

  it('says the passcode did not work on a 401 and stays locked', async () => {
    const createSession = vi
      .fn<ApiClient['createSession']>()
      .mockRejectedValue(new ApiError(ERROR.UNAUTHORIZED, 'bad passcode', 401));
    const session = createSessionStore();
    session.lock();
    view = await mount(<Probe />, fakeServices({ api: fakeApi({ createSession }), session }));

    await act(() => handle.submit?.('wrong'));

    expect(view.container.textContent).toBe('locked That passcode did not work.');
  });

  it('reports a network failure differently from a wrong passcode', async () => {
    const createSession = vi
      .fn<ApiClient['createSession']>()
      .mockRejectedValue(new ApiError('NETWORK_ERROR', 'offline', null));
    view = await mount(<Probe />, fakeServices({ api: fakeApi({ createSession }) }));

    await act(() => handle.submit?.('x'));

    expect(view.container.textContent).toBe('unknown Could not reach the server.');
  });
});

function CheckProbe() {
  useSessionCheck();
  return <output>{useSessionStatus()}</output>;
}

describe('useSessionCheck', () => {
  it('asks GET /session once and unlocks while the cookie is valid', async () => {
    const getSession = vi.fn<ApiClient['getSession']>().mockResolvedValue({ user_id: 'u1' });
    view = await mount(<CheckProbe />, fakeServices({ api: fakeApi({ getSession }) }));
    await act(() => Promise.resolve());

    expect(getSession).toHaveBeenCalledTimes(1);
    expect(view.container.textContent).toBe('active');
  });

  it('stays unknown on a 401, leaving the lock to the API client', async () => {
    const getSession = vi
      .fn<ApiClient['getSession']>()
      .mockRejectedValue(new ApiError(ERROR.UNAUTHORIZED, 'sign in first', 401));
    view = await mount(<CheckProbe />, fakeServices({ api: fakeApi({ getSession }) }));
    await act(() => Promise.resolve());

    expect(view.container.textContent).toBe('unknown');
  });

  it('opens the app when the server cannot be reached', async () => {
    const getSession = vi
      .fn<ApiClient['getSession']>()
      .mockRejectedValue(new ApiError('NETWORK_ERROR', 'offline', null));
    view = await mount(<CheckProbe />, fakeServices({ api: fakeApi({ getSession }) }));
    await act(() => Promise.resolve());

    expect(view.container.textContent).toBe('active');
  });

  it('does not ask again once the session is known', async () => {
    const getSession = vi.fn<ApiClient['getSession']>();
    const session = createSessionStore();
    session.lock();
    view = await mount(<CheckProbe />, fakeServices({ api: fakeApi({ getSession }), session }));

    expect(getSession).not.toHaveBeenCalled();
    expect(view.container.textContent).toBe('locked');
  });
});
