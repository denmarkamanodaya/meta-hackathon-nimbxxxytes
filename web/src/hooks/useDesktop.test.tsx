import { act } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import status from '../test-support/fixtures/sync-status.json';
import { fakeTauri } from '../test-support/fake-tauri';
import { fakeApi, fakeServices, mount, type Mounted } from '../test-support/services';
import { createNativeBridge } from '../services/desktop/native-bridge';
import { createSessionStore } from '../services/session/session-store';
import { ApiError } from '../services/api/client';
import { ERROR } from '../services/api/types';
import { useClipOffline, useFirstRun, usePickAndUpload, useSyncActions } from './useDesktop';

let view: Mounted | null = null;
afterEach(() => {
  view?.unmount();
  view = null;
});

const flush = () =>
  act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });

function OfflineProbe({ clipId }: { clipId: string }) {
  const { isPinned, setPinned } = useClipOffline(clipId);
  return (
    <button type="button" onClick={() => void setPinned(isPinned !== true)}>
      {String(isPinned)}
    </button>
  );
}

describe('useClipOffline', () => {
  it('reads pinned from the sync status and sends set_offline on a flip', async () => {
    const tauri = fakeTauri({ sync_status: { resolve: status }, set_offline: { resolve: null } });
    view = await mount(<OfflineProbe clipId="c9" />, fakeServices({ desktop: createNativeBridge(tauri.ipc) }));
    await flush();
    expect(view.container.textContent).toBe('false');

    act(() => {
      view?.container.querySelector('button')?.click();
    });
    await flush();

    expect(view.container.textContent).toBe('true');
    expect(tauri.calls.find((c) => c.command === 'set_offline')?.args).toEqual({ clip_id: 'c9', offline: true });
  });

  it('puts the switch back and shows a toast when the native call fails', async () => {
    const tauri = fakeTauri({ sync_status: { resolve: status }, set_offline: { reject: 'disk full' } });
    const services = fakeServices({ desktop: createNativeBridge(tauri.ipc) });
    const error = vi.spyOn(services.toasts, 'error');
    view = await mount(<OfflineProbe clipId="c1" />, services);
    await flush();
    expect(view.container.textContent).toBe('true');

    act(() => {
      view?.container.querySelector('button')?.click();
    });
    await flush();

    expect(view.container.textContent).toBe('true');
    expect(error).toHaveBeenCalledWith('Could not free the original', expect.objectContaining({ code: 'DESKTOP_FAILED' }));
  });
});

describe('useSyncActions: sign out', () => {
  function Probe() {
    const { signOut } = useSyncActions();
    return <button type="button" onClick={() => void signOut()} />;
  }

  it('clears the Keychain session and locks even when the server is unreachable', async () => {
    const tauri = fakeTauri({ sign_out: { resolve: null } });
    const session = createSessionStore();
    session.unlock();
    const signOut = vi.fn(() => Promise.reject(new Error('offline')));
    const api = fakeApi({ signOut });
    view = await mount(<Probe />, fakeServices({ api, session, desktop: createNativeBridge(tauri.ipc) }));

    act(() => {
      view?.container.querySelector('button')?.click();
    });
    await flush();

    expect(signOut).toHaveBeenCalledTimes(1);
    expect(tauri.calls.map((c) => c.command)).toEqual(['sign_out']);
    expect(session.getSnapshot()).toBe('locked');
  });
});

describe('useFirstRun', () => {
  function Probe({ folder }: { folder: string }) {
    const { state, submit } = useFirstRun();
    return (
      <button type="button" onClick={() => void submit({ server: ' https://box.example ', passcode: 'pw', folder })}>
        {state.status === 'error' ? state.message : state.status}
      </button>
    );
  }
  const native = () =>
    fakeTauri({
      server_get: { resolve: { url: null } },
      folder_get: { resolve: { path: '/Users/me/nimbytes' } },
      server_set: { resolve: { url: 'https://box.example' } },
      folder_set: { resolve: { path: '/Volumes/T7/nimbytes' } },
    });

  it('saves the trimmed server, moves a changed folder, then signs in and unlocks', async () => {
    const tauri = native();
    const createSession = vi.fn(() => Promise.resolve({ user_id: 'u1' }));
    const session = createSessionStore();
    view = await mount(
      <Probe folder="/Volumes/T7/nimbytes" />,
      fakeServices({ api: fakeApi({ createSession }), session, desktop: createNativeBridge(tauri.ipc) }),
    );
    await flush();

    act(() => {
      view?.container.querySelector('button')?.click();
    });
    await flush();
    await flush();

    expect(tauri.calls.map((c) => [c.command, c.args])).toEqual([
      ['server_get', undefined],
      ['folder_get', undefined],
      ['server_set', { url: 'https://box.example' }],
      ['folder_set', { path: '/Volumes/T7/nimbytes' }],
    ]);
    expect(createSession).toHaveBeenCalledWith('pw');
    expect(session.getSnapshot()).toBe('active');
  });

  it('keeps the folder when unchanged and says when the passcode is refused', async () => {
    const tauri = native();
    const createSession = vi.fn(() => Promise.reject(new ApiError(ERROR.UNAUTHORIZED, 'no', 401)));
    view = await mount(
      <Probe folder="/Users/me/nimbytes" />,
      fakeServices({ api: fakeApi({ createSession }), desktop: createNativeBridge(tauri.ipc) }),
    );
    await flush();

    act(() => {
      view?.container.querySelector('button')?.click();
    });
    await flush();
    await flush();

    expect(tauri.calls.map((c) => c.command)).not.toContain('folder_set');
    expect(view.container.textContent).toBe('That passcode did not work.');
  });
});

describe('usePickAndUpload', () => {
  function Probe() {
    const { pick } = usePickAndUpload();
    return <button type="button" onClick={() => void pick()} />;
  }

  it('opens pick_and_upload and tells how many clips were queued', async () => {
    const tauri = fakeTauri({ pick_and_upload: { resolve: { queued: 2 } } });
    const services = fakeServices({ desktop: createNativeBridge(tauri.ipc) });
    const info = vi.spyOn(services.toasts, 'info');
    view = await mount(<Probe />, services);

    act(() => {
      view?.container.querySelector('button')?.click();
    });
    await flush();

    expect(tauri.calls.map((c) => c.command)).toEqual(['pick_and_upload']);
    expect(info).toHaveBeenCalledWith('Uploading', '2 clips queued.');
  });
});
