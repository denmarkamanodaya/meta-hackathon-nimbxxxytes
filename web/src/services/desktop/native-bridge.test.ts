import { describe, expect, it, vi } from 'vitest';
import status from '../../test-support/fixtures/sync-status.json';
import { fakeTauri } from '../../test-support/fake-tauri';
import documentsJson from '../../test-support/fixtures/documents.json';
import { documentItem, driveItemRef } from '../../core/gallery-items';
import { parseDocumentList } from '../api/parse-documents';
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
      items: [],
      pinnedItems: [],
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
        clips: [
          { clipId: 'c1', cachedBytes: 48000000, lastReadAt: '2026-10-27T08:50:00Z' },
          { clipId: 'c2', cachedBytes: 0, lastReadAt: null },
          { clipId: 'c3', cachedBytes: 4000000, lastReadAt: '2026-10-27T08:59:00Z' },
        ],
      },
      pollS: 30,
      cacheCapBytes: 5000000000,
      releaseAfterS: 180,
    });
  });

  it('reads the drive fields as optional: a missing cached_bytes, last_read_at, cap or release time is 0 or null', () => {
    const bare: Record<string, unknown> = {
      ...status,
      clips: status.clips.map((row) => {
        const copy: Record<string, unknown> = { ...row };
        delete copy.cached_bytes;
        delete copy.last_read_at;
        return copy;
      }),
    };
    delete bare.cache_cap_bytes;
    delete bare.release_after_s;

    const parsed = parseSyncStatus(bare);

    expect(parsed?.local.clips).toEqual([
      { clipId: 'c1', cachedBytes: 0, lastReadAt: null },
      { clipId: 'c2', cachedBytes: 0, lastReadAt: null },
      { clipId: 'c3', cachedBytes: 0, lastReadAt: null },
    ]);
    expect(parsed?.cacheCapBytes).toBe(0);
    expect(parsed?.releaseAfterS).toBeNull();
  });

  it('rejects drive fields of the wrong type', () => {
    expect(parseSyncStatus({ ...status, clips: [{ ...status.clips[0], cached_bytes: -1 }] })).toBeNull();
    expect(parseSyncStatus({ ...status, clips: [{ ...status.clips[0], last_read_at: 12 }] })).toBeNull();
    expect(parseSyncStatus({ ...status, cache_cap_bytes: '5 GB' })).toBeNull();
    expect(parseSyncStatus({ ...status, release_after_s: -180 })).toBeNull();
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

    expect(parsed?.local).toEqual({ proxyClipIds: [], proxyBytes: 0, originalClipIds: [], pinnedBytes: 0, renders: 0, projects: 0, clips: [] });
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

  it('reads the other kinds\' items and pinned_items, and rejects a bad row', () => {
    const items = [{ item: 'listen:l1', cached_bytes: 2_450_000, last_read_at: '2026-10-27T08:50:00Z', pinned: true }];
    expect(parseSyncStatus({ ...status, items, pinned_items: ['listen:l1'] })).toMatchObject({
      items: [{ item: 'listen:l1', cachedBytes: 2_450_000, lastReadAt: '2026-10-27T08:50:00Z', pinned: true }],
      pinnedItems: ['listen:l1'],
    });
    expect(parseSyncStatus({ ...status, items: [{ ...items[0], pinned: 'yes' }] })).toBeNull();
    expect(parseSyncStatus({ ...status, items: [{ ...items[0], cached_bytes: -1 }] })).toBeNull();
    expect(parseSyncStatus({ ...status, pinned_items: [1] })).toBeNull();
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
  it('names a document by its Gallery id for the drive: offline toggle and Show in Finder send doc:<id>', async () => {
    const water = parseDocumentList(documentsJson)?.[0];
    if (water === undefined) throw new Error('documents.json changed');
    const tauri = fakeTauri({ set_item_offline: { resolve: null }, reveal: { resolve: null } });
    const bridge = createNativeBridge(tauri.ipc);

    await bridge.setItemOffline(driveItemRef(documentItem(water)), true);
    await bridge.reveal({ kind: 'item', itemId: driveItemRef(documentItem(water)) });

    expect(tauri.calls).toEqual([
      { command: 'set_item_offline', args: { item: 'doc:doc_water', offline: true } },
      { command: 'reveal', args: { kind: 'item', id: 'doc:doc_water' } },
    ]);
  });


  it('sends set_offline, set_item_offline, set_cache_budget and open_in_nle with the contract arg names', async () => {
    const tauri = fakeTauri({
      set_offline: { resolve: null },
      set_item_offline: { resolve: null },
      set_cache_budget: { resolve: null },
      open_in_nle: { resolve: { fcpxml_path: '/Users/me/nimbytes/Projects/a.fcpxml', opened_with: 'finder' } },
    });
    const bridge = createNativeBridge(tauri.ipc);

    await bridge.setOffline('c1', true);
    await bridge.setItemOffline('doc:d1', false);
    await bridge.setCacheBudget(50);
    const opened = await bridge.openInEditor('s1');

    expect(tauri.calls).toEqual([
      { command: 'set_offline', args: { clip_id: 'c1', offline: true } },
      { command: 'set_item_offline', args: { item: 'doc:d1', offline: false } },
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
      pick_and_upload: { resolve: { queued: 3, images: [{ path: '/p/IMG_1.HEIC', name: 'IMG_1.HEIC', content_type: 'image/heic', size_bytes: 4, last_modified_ms: 1_755_592_920_000 }] } },
      read_picked_image: { resolve: new Uint8Array([1, 2, 3, 4]).buffer },
    });
    const bridge = createNativeBridge(tauri.ipc);

    await expect(bridge.server()).resolves.toBe('https://box.example');
    const picked = await bridge.pickAndUpload();
    expect(picked).toEqual({
      queued: 3,
      images: [{ path: '/p/IMG_1.HEIC', name: 'IMG_1.HEIC', contentType: 'image/heic', sizeBytes: 4, lastModifiedMs: 1_755_592_920_000 }],
    });
    const image = picked.images[0];
    if (image === undefined) throw new Error('no image');
    const file = await bridge.readPickedImage(image);
    expect([file.name, file.type, file.size, file.lastModified]).toEqual(['IMG_1.HEIC', 'image/heic', 4, 1_755_592_920_000]);
    expect(tauri.calls).toEqual([
      { command: 'server_get', args: undefined },
      { command: 'pick_and_upload', args: undefined },
      { command: 'read_picked_image', args: { path: '/p/IMG_1.HEIC' } },
    ]);
  });

  it('reads the app version with Tauri’s plugin:app|version, and refuses an empty answer', async () => {
    const tauri = fakeTauri({ 'plugin:app|version': { resolve: '1.0.4' } });

    await expect(createNativeBridge(tauri.ipc).appVersion()).resolves.toBe('1.0.4');
    expect(tauri.calls).toEqual([{ command: 'plugin:app|version', args: undefined }]);
    const empty = fakeTauri({ 'plugin:app|version': { resolve: '' } });
    await expect(createNativeBridge(empty.ipc).appVersion()).rejects.toMatchObject({ code: 'DESKTOP_FAILED' });
  });

  it('reads and sets opening at login with login_get and login_set { enabled }', async () => {
    const tauri = fakeTauri({ login_get: { resolve: true }, login_set: { resolve: null } });
    const bridge = createNativeBridge(tauri.ipc);

    await expect(bridge.loginEnabled()).resolves.toBe(true);
    await bridge.setLoginEnabled(false);
    expect(tauri.calls).toEqual([
      { command: 'login_get', args: undefined },
      { command: 'login_set', args: { enabled: false } },
    ]);
    const odd = fakeTauri({ login_get: { resolve: 'yes' } });
    await expect(createNativeBridge(odd.ipc).loginEnabled()).rejects.toMatchObject({ code: 'DESKTOP_FAILED' });
  });

  it('frees space with free_up_space and reads the bytes freed', async () => {
    const tauri = fakeTauri({ free_up_space: { resolve: 41_000_000 } });

    await expect(createNativeBridge(tauri.ipc).freeUpSpace()).resolves.toBe(41_000_000);
    expect(tauri.calls).toEqual([{ command: 'free_up_space', args: undefined }]);
    const odd = fakeTauri({ free_up_space: { resolve: -1 } });
    await expect(createNativeBridge(odd.ipc).freeUpSpace()).rejects.toMatchObject({ code: 'DESKTOP_FAILED' });
  });

  it('queues a folder with pick_folder_and_upload and cancels with cancel_upload { transfer_id }', async () => {
    const tauri = fakeTauri({
      pick_folder_and_upload: { resolve: { queued: 5 } },
      cancel_upload: { resolve: null },
    });
    const bridge = createNativeBridge(tauri.ipc);

    await expect(bridge.pickFolderAndUpload()).resolves.toBe(5);
    await bridge.cancelUpload('Export:/Users/me/Movies/VID_1.mp4');
    expect(tauri.calls).toEqual([
      { command: 'pick_folder_and_upload', args: undefined },
      { command: 'cancel_upload', args: { transfer_id: 'Export:/Users/me/Movies/VID_1.mp4' } },
    ]);
    const odd = fakeTauri({ pick_folder_and_upload: { resolve: { queued: 'all' } } });
    await expect(createNativeBridge(odd.ipc).pickFolderAndUpload()).rejects.toMatchObject({ code: 'DESKTOP_FAILED' });
    const refused = fakeTauri({ cancel_upload: { reject: 'no such upload' } });
    await expect(createNativeBridge(refused.ipc).cancelUpload('x')).rejects.toMatchObject({ code: 'DESKTOP_FAILED', message: 'no such upload' });
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
