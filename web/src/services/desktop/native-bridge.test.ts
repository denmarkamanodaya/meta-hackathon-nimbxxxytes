import { describe, expect, it, vi } from 'vitest';
import status from '../../test-support/fixtures/sync-status.json';
import { fakeTauri } from '../../test-support/fake-tauri';
import { createNativeBridge, parseSyncStatus } from './native-bridge';

describe('parseSyncStatus', () => {
  it('maps the native snake_case status to the core type', () => {
    expect(parseSyncStatus(status)).toEqual({
      folder: '/Users/me/nimbytes',
      lastSyncAt: '2026-10-27T09:00:00Z',
      state: 'syncing',
      error: null,
      counts: { clips: 12, shorts: 1, originalsOffline: 2 },
      pinnedClipIds: ['c1', 'c2'],
      cache: { budgetGb: 20, autoBytes: 3400000000 },
      cacheBytes: 52000000,
      transfers: [
        { id: 't1', kind: 'proxy', name: 'Beach walk.mp4', doneBytes: 12400000, totalBytes: 40000000, direction: 'down', clipId: 'c3' },
        { id: 't2', kind: 'export', name: 'Final cut.mov', doneBytes: 0, totalBytes: 0, direction: 'up', clipId: null },
      ],
      exports: [
        { name: 'Final cut.mov', state: 'uploading', error: null },
        { name: 'Old.mp4', state: 'failed', error: 'The server refused the file' },
      ],
      local: {
        proxyClipIds: ['c1', 'c3'],
        proxyBytes: 38000000,
        originalClipIds: ['c1'],
        pinnedBytes: 48000000,
        renders: 4,
        projects: 1,
      },
      pollS: 30,
    });
  });

  it('reads a status without the clips rows, byte counts, cache_bytes, poll_s and transfer clip_id as empty, zero, unknown and null', () => {
    const bare: Record<string, unknown> = {
      ...status,
      transfers: status.transfers.map((transfer) => {
        const copy: Record<string, unknown> = { ...transfer };
        delete copy.clip_id;
        return copy;
      }),
    };
    delete bare.clips;
    delete bare.local_proxy_bytes;
    delete bare.pinned_bytes;
    delete bare.renders;
    delete bare.projects;
    delete bare.poll_s;
    delete bare.cache_bytes;

    const parsed = parseSyncStatus(bare);

    expect(parsed?.local).toEqual({ proxyClipIds: [], proxyBytes: 0, originalClipIds: [], pinnedBytes: 0, renders: 0, projects: 0 });
    expect(parsed?.pollS).toBeNull();
    expect(parsed?.cacheBytes).toBe(0);
    expect(parsed?.transfers.map((t) => t.clipId)).toEqual([null, null]);
  });

  it('rejects a clips row, a byte count, cache_bytes or poll_s of the wrong type', () => {
    expect(parseSyncStatus({ ...status, clips: [{ ...status.clips[0], proxy: 'half' }] })).toBeNull();
    expect(parseSyncStatus({ ...status, local_proxy_bytes: -1 })).toBeNull();
    expect(parseSyncStatus({ ...status, poll_s: '30' })).toBeNull();
    expect(parseSyncStatus({ ...status, cache_bytes: -5 })).toBeNull();
    expect(parseSyncStatus({ ...status, cache_bytes: '52' })).toBeNull();
  });

  it('reads a missing pinned_clip_ids as none', () => {
    const withoutPinned: Record<string, unknown> = { ...status };
    delete withoutPinned.pinned_clip_ids;

    expect(parseSyncStatus(withoutPinned)?.pinnedClipIds).toEqual([]);
  });

  it('rejects an unknown state, a bad transfer and a missing cache', () => {
    expect(parseSyncStatus({ ...status, state: 'paused' })).toBeNull();
    expect(parseSyncStatus({ ...status, transfers: [{ ...status.transfers[0], direction: 'sideways' }] })).toBeNull();
    const withoutCache: Record<string, unknown> = { ...status };
    delete withoutCache.cache;
    expect(parseSyncStatus(withoutCache)).toBeNull();
  });
});

describe('createNativeBridge', () => {
  it('sends set_offline, set_cache_budget and open_in_nle with the contract arg names', async () => {
    const tauri = fakeTauri({
      set_offline: { resolve: null },
      set_cache_budget: { resolve: null },
      open_in_nle: { resolve: { fcpxml_path: '/Users/me/nimbytes/Projects/a.fcpxml', opened_with: 'finder' } },
    });
    const bridge = createNativeBridge(tauri.ipc);

    await bridge.setOffline('c1', true);
    await bridge.setCacheBudget(50);
    const opened = await bridge.openInEditor('s1');

    expect(tauri.calls).toEqual([
      { command: 'set_offline', args: { clip_id: 'c1', offline: true } },
      { command: 'set_cache_budget', args: { gb: 50 } },
      { command: 'open_in_nle', args: { short_id: 's1' } },
    ]);
    expect(opened).toEqual({ fcpxmlPath: '/Users/me/nimbytes/Projects/a.fcpxml', openedWith: 'finder' });
  });

  it('sends reveal with kind plus the clip or short id, and no id for the folder', async () => {
    const tauri = fakeTauri({ reveal: { resolve: null } });
    const bridge = createNativeBridge(tauri.ipc);

    await bridge.reveal({ kind: 'folder' });
    await bridge.reveal({ kind: 'fcpxml', shortId: 's1' });
    await bridge.reveal({ kind: 'render', shortId: 's1' });
    await bridge.reveal({ kind: 'original', clipId: 'c1' });

    expect(tauri.calls.map((c) => c.args)).toEqual([
      { kind: 'folder' },
      { kind: 'fcpxml', id: 's1' },
      { kind: 'render', id: 's1' },
      { kind: 'original', id: 'c1' },
    ]);
  });

  it('reads the server URL with server_get and queues uploads with pick_and_upload', async () => {
    const tauri = fakeTauri({
      server_get: { resolve: { url: 'https://box.example' } },
      pick_and_upload: { resolve: { queued: 3 } },
    });
    const bridge = createNativeBridge(tauri.ipc);

    await expect(bridge.server()).resolves.toBe('https://box.example');
    await expect(bridge.pickAndUpload()).resolves.toBe(3);
    expect(tauri.calls).toEqual([
      { command: 'server_get', args: undefined },
      { command: 'pick_and_upload', args: undefined },
    ]);
  });

  it('rejects a malformed pick_and_upload answer with DESKTOP_FAILED', async () => {
    const tauri = fakeTauri({ pick_and_upload: { resolve: { queued: -1 } } });

    await expect(createNativeBridge(tauri.ipc).pickAndUpload()).rejects.toMatchObject({ code: 'DESKTOP_FAILED' });
  });

  it('keeps the message of a native { code, message } rejection', async () => {
    const reject = { code: 'IO', message: 'disk full' } as unknown as Error;
    const tauri = fakeTauri({ sync_now: { reject } });

    await expect(createNativeBridge(tauri.ipc).syncNow()).rejects.toMatchObject({
      code: 'DESKTOP_FAILED',
      message: 'disk full',
    });
  });

  it('rejects a refused command with DESKTOP_FAILED and the native message', async () => {
    const tauri = fakeTauri({ sync_now: { reject: 'already syncing' } });

    await expect(createNativeBridge(tauri.ipc).syncNow()).rejects.toMatchObject({
      code: 'DESKTOP_FAILED',
      message: 'already syncing',
    });
  });

  it('rejects a malformed sync_status with DESKTOP_FAILED', async () => {
    const tauri = fakeTauri({ sync_status: { resolve: { folder: 1 } } });

    await expect(createNativeBridge(tauri.ipc).syncStatus()).rejects.toMatchObject({ code: 'DESKTOP_FAILED' });
  });

  it('passes pushed sync://status updates through the parser and stops listening on unsubscribe', async () => {
    const tauri = fakeTauri();
    const listener = vi.fn();
    const stop = createNativeBridge(tauri.ipc).onSyncStatus(listener);
    await Promise.resolve();

    tauri.emit('sync://status', status);
    tauri.emit('sync://status', { broken: true });
    stop();
    tauri.emit('sync://status', status);

    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener.mock.calls[0]?.[0]).toMatchObject({ state: 'syncing', folder: '/Users/me/nimbytes' });
    expect(tauri.listenerCount('sync://status')).toBe(0);
  });
});
