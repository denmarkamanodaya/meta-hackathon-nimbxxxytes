import { act } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import status from '../test-support/fixtures/sync-status.json';
import { fakeTauri } from '../test-support/fake-tauri';
import { fakeApi, fakeServices, mount, type Mounted } from '../test-support/services';
import { createNativeBridge } from '../services/desktop/native-bridge';
import { createSessionStore } from '../services/session/session-store';
import { useClipOffline, useFreeUpSpace, useGalleryUploads, useOpenAtLogin, usePickAndUpload, useSyncActions } from './useDesktop';

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
    const { pick, pickFolder } = usePickAndUpload();
    return (
      <>
        <button type="button" id="files" onClick={() => void pick()} />
        <button type="button" id="folder" onClick={() => void pickFolder()} />
      </>
    );
  }

  it('opens pick_and_upload or pick_folder_and_upload and says nothing more (the Gallery shows the uploads)', async () => {
    const tauri = fakeTauri({ pick_and_upload: { resolve: { queued: 2 } }, pick_folder_and_upload: { resolve: { queued: 0 } } });
    const services = fakeServices({ desktop: createNativeBridge(tauri.ipc) });
    const info = vi.spyOn(services.toasts, 'info');
    const error = vi.spyOn(services.toasts, 'error');
    view = await mount(<Probe />, services);

    act(() => {
      view?.container.querySelector<HTMLButtonElement>('#files')?.click();
    });
    await flush();
    act(() => {
      view?.container.querySelector<HTMLButtonElement>('#folder')?.click();
    });
    await flush();

    expect(tauri.calls.map((c) => c.command)).toEqual(['pick_and_upload', 'pick_folder_and_upload']);
    expect(info).not.toHaveBeenCalled();
    expect(error).not.toHaveBeenCalled();
  });

  it('shows a toast when the dialog cannot open', async () => {
    const tauri = fakeTauri({ pick_folder_and_upload: { reject: 'not signed in' } });
    const services = fakeServices({ desktop: createNativeBridge(tauri.ipc) });
    const error = vi.spyOn(services.toasts, 'error');
    view = await mount(<Probe />, services);

    act(() => {
      view?.container.querySelector<HTMLButtonElement>('#folder')?.click();
    });
    await flush();

    expect(error).toHaveBeenCalledWith('Could not start the upload', expect.objectContaining({ code: 'DESKTOP_FAILED' }));
  });
});

describe('useGalleryUploads', () => {
  const picked = 'Export:/Users/me/Movies/VID_1.mp4';
  const uploading = {
    ...status,
    transfers: [
      { id: picked, kind: 'export', name: 'VID_1.mp4', done_bytes: 0, total_bytes: 1_000_000_000, direction: 'up', clip_id: 'c1' },
    ],
    exports: [],
  };
  const withDone = (done: number) => ({ ...uploading, transfers: [{ ...uploading.transfers[0], done_bytes: done }] });

  function Probe() {
    const { uploads, line, cancel } = useGalleryUploads();
    return (
      <>
        <output>{line ?? 'none'}</output>
        {uploads.map((u) => (
          <button key={u.key} type="button" onClick={() => {
              if (u.cancelId !== null) cancel(u.cancelId);
            }}
          >
            {u.label}
          </button>
        ))}
      </>
    );
  }

  it('shows the uploads with a time left from the pushed progress, and hides a cancelled one at once', async () => {
    const now = vi.spyOn(performance, 'now');
    const tauri = fakeTauri({ sync_status: { resolve: uploading }, cancel_upload: { resolve: null } });
    view = await mount(<Probe />, fakeServices({ desktop: createNativeBridge(tauri.ipc) }));
    await flush();
    expect(view.container.querySelector('output')?.textContent).toBe('Uploading 1 clip · 0 of 1 GB');

    now.mockReturnValue(1_000);
    act(() => {
      tauri.emit('sync://status', withDone(100_000_000));
    });
    now.mockReturnValue(3_000);
    act(() => {
      tauri.emit('sync://status', withDone(110_000_000));
    });

    expect(view.container.querySelector('output')?.textContent).toBe('Uploading 1 clip · 0.1 of 1 GB · about 3 min left');
    expect(view.container.querySelector('button')?.textContent).toBe('Uploading 11%');

    act(() => {
      view?.container.querySelector('button')?.click();
    });
    await flush();

    expect(tauri.calls.find((c) => c.command === 'cancel_upload')?.args).toEqual({ transfer_id: picked });
    expect(view.container.querySelector('button')).toBeNull();
    expect(view.container.querySelector('output')?.textContent).toBe('none');
    now.mockRestore();
  });

  it('brings a tile back with a toast when the cancel fails', async () => {
    const tauri = fakeTauri({ sync_status: { resolve: withDone(100_000_000) }, cancel_upload: { reject: 'gone' } });
    const services = fakeServices({ desktop: createNativeBridge(tauri.ipc) });
    const error = vi.spyOn(services.toasts, 'error');
    view = await mount(<Probe />, services);
    await flush();

    act(() => {
      view?.container.querySelector('button')?.click();
    });
    await flush();

    expect(view.container.querySelector('button')?.textContent).toBe('Uploading 10%');
    expect(error).toHaveBeenCalledWith('Could not cancel the upload', expect.objectContaining({ code: 'DESKTOP_FAILED' }));
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
