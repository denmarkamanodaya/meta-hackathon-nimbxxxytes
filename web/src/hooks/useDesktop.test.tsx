import { act } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import status from '../test-support/fixtures/sync-status.json';
import { fakeTauri } from '../test-support/fake-tauri';
import { fakeApi, fakeServices, mount, type Mounted } from '../test-support/services';
import { createNativeBridge } from '../services/desktop/native-bridge';
import { createSessionStore } from '../services/session/session-store';
import { useClipOffline, useFreeUpSpace, useOpenAtLogin, usePickAndUpload, useSyncActions } from './useDesktop';

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

describe('useOpenAtLogin', () => {
  function Probe() {
    const { isEnabled, setEnabled } = useOpenAtLogin();
    return (
      <button type="button" onClick={() => void setEnabled(isEnabled !== true)}>
        {String(isEnabled)}
      </button>
    );
  }

  it('reads login_get, then sends login_set with the new state', async () => {
    const tauri = fakeTauri({ login_get: { resolve: false }, login_set: { resolve: null } });
    view = await mount(<Probe />, fakeServices({ desktop: createNativeBridge(tauri.ipc) }));
    await flush();
    expect(view.container.textContent).toBe('false');

    act(() => {
      view?.container.querySelector('button')?.click();
    });
    await flush();

    expect(view.container.textContent).toBe('true');
    expect(tauri.calls.find((c) => c.command === 'login_set')?.args).toEqual({ enabled: true });
  });

  it('puts the switch back and shows a toast when login_set fails', async () => {
    const tauri = fakeTauri({ login_get: { resolve: true }, login_set: { reject: 'not allowed' } });
    const services = fakeServices({ desktop: createNativeBridge(tauri.ipc) });
    const error = vi.spyOn(services.toasts, 'error');
    view = await mount(<Probe />, services);
    await flush();

    act(() => {
      view?.container.querySelector('button')?.click();
    });
    await flush();

    expect(view.container.textContent).toBe('true');
    expect(error).toHaveBeenCalledWith('Could not stop opening at login', expect.objectContaining({ code: 'DESKTOP_FAILED' }));
  });
});

describe('useFreeUpSpace', () => {
  it('calls free_up_space, says how much it freed, then asks for a status reload', async () => {
    const tauri = fakeTauri({ free_up_space: { resolve: 41_000_000 } });
    const services = fakeServices({ desktop: createNativeBridge(tauri.ipc) });
    const info = vi.spyOn(services.toasts, 'info');
    const onFreed = vi.fn();
    function Probe() {
      const { freeUpSpace } = useFreeUpSpace(onFreed);
      return <button type="button" onClick={() => void freeUpSpace()} />;
    }
    view = await mount(<Probe />, services);

    act(() => {
      view?.container.querySelector('button')?.click();
    });
    await flush();

    expect(tauri.calls.map((c) => c.command)).toEqual(['free_up_space']);
    expect(info).toHaveBeenCalledWith('Freed 41 MB', '');
    expect(onFreed).toHaveBeenCalledTimes(1);
  });
});
