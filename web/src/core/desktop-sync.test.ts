import { describe, expect, it } from 'vitest';
import {
  bytePair,
  displayFolder,
  lastSyncLabel,
  serverOrigin,
  syncProblem,
  sidebarStatus,
  spaceUsedLabel,
  storageTiles,
  syncPanelView,
  transferRow,
  type SyncStatus,
  type SyncTransfer,
} from './desktop-sync';

const now = new Date('2026-10-27T10:00:00Z');

const status: SyncStatus = {
  folder: '/Users/me/nimbytes',
  lastSyncAt: '2026-10-27T09:58:00Z',
  state: 'idle',
  error: null,
  counts: { clips: 4, shorts: 4, originalsOffline: 1 },
  pinnedClipIds: ['c2'],
  cache: { budgetGb: 20, autoBytes: 96_000_000 },
  cacheBytes: 0,
  transfers: [],
  exports: [],
  local: {
    proxyClipIds: ['c1', 'c2', 'c3'],
    proxyBytes: 38_000_000,
    originalClipIds: ['c2'],
    pinnedBytes: 48_000_000,
    renders: 4,
    projects: 1,
  },
  pollS: 30,
};

const transfer = (over: Partial<SyncTransfer>): SyncTransfer => ({
  id: 't1',
  kind: 'proxy',
  name: 'Terminal log review',
  doneBytes: 4_100_000,
  totalBytes: 10_000_000,
  direction: 'down',
  clipId: 'c4',
  ...over,
});

describe('displayFolder', () => {
  it('shortens the home folder to ~ and leaves other paths alone', () => {
    expect(displayFolder('/Users/me/nimbytes')).toBe('~/nimbytes');
    expect(displayFolder('/Users/me')).toBe('~');
    expect(displayFolder('/Volumes/T7/nimbytes')).toBe('/Volumes/T7/nimbytes');
  });
});

describe('lastSyncLabel', () => {
  it('says Never before the first sync or for an unreadable instant', () => {
    expect(lastSyncLabel(null, now)).toBe('Never');
    expect(lastSyncLabel('soon', now)).toBe('Never');
  });

  it('says Just now under a minute and whole minutes under an hour', () => {
    expect(lastSyncLabel('2026-10-27T09:59:30Z', now)).toBe('Just now');
    expect(lastSyncLabel('2026-10-27T09:58:30Z', now)).toBe('1 min ago');
    expect(lastSyncLabel('2026-10-27T09:01:00Z', now)).toBe('59 min ago');
  });

  it('falls back to the day and time from an hour on', () => {
    expect(lastSyncLabel('2026-10-27T07:42:00Z', now, 'UTC')).toBe('Today 7:42 am');
  });
});

describe('sidebarStatus', () => {
  it('matches the mock: "Synced" + "2 min ago · ~/nimbytes"', () => {
    expect(sidebarStatus(status, now)).toEqual({ label: 'Synced', tone: 'ok', line: '2 min ago · ~/nimbytes' });
  });

  it('says when nothing synced yet', () => {
    const fresh = { ...status, lastSyncAt: null, pollS: null, state: 'syncing' as const };

    expect(sidebarStatus(fresh, now)).toEqual({ label: 'Syncing…', tone: 'busy', line: 'Not synced yet · ~/nimbytes' });
  });
});

describe('storageTiles', () => {
  it('never describes storage tiers', () => {
    const lines = storageTiles({ bytes: 1, clips: 1 }, status).map((tile) => `${tile.label} ${tile.line}`).join(' ');

    expect(lines).not.toMatch(/tier|cheaper|resting/i);
  });

  it('builds the two tiles: the cloud from storage, this Mac from cache_bytes', () => {
    expect(storageTiles({ bytes: 125_000_000, clips: 4 }, { ...status, cacheBytes: 52_000_000 })).toEqual([
      { label: 'In your cloud', value: '125 MB', line: '4 clips · plays from the cloud', isAccent: false },
      { label: 'On this Mac', value: '52 MB', line: 'nimbytes frees space on its own', isAccent: true },
    ]);
  });

  it('says "0 bytes" for an empty cache, and shows a dash while a source is missing', () => {
    expect(storageTiles(null, status)[1]?.value).toBe('0 bytes');
    expect(storageTiles(null, null).map((tile) => [tile.value, tile.line])).toEqual([
      ['—', ''],
      ['—', ''],
    ]);
  });
});

describe('transferRow and bytePair', () => {
  it('formats bytes in the total unit like the mock', () => {
    expect(bytePair(4_100_000, 10_000_000)).toBe('4.1/10 MB');
    expect(bytePair(500_000_000, 1_200_000_000)).toBe('0.5/1.2 GB');
  });

  it('shows arrow, kind, percent and Done once complete', () => {
    expect(transferRow(transfer({}))).toEqual({
      id: 't1',
      arrow: '↓',
      name: 'Terminal log review',
      kind: 'proxy',
      percent: 41,
      isDone: false,
      progress: '4.1/10 MB',
    });
    expect(transferRow(transfer({ doneBytes: 10_000_000 }))).toMatchObject({ isDone: true, progress: 'Done', percent: 100 });
    expect(transferRow(transfer({ direction: 'up', kind: 'export', totalBytes: 0, doneBytes: 950_000 }))).toMatchObject({
      arrow: '↑',
      percent: 0,
      progress: '950 KB',
    });
  });
});

describe('syncPanelView', () => {
  it('builds the V1 status card: title, clips and shorts held, last check, space used', () => {
    expect(syncPanelView({ ...status, counts: { clips: 4, shorts: 3, originalsOffline: 1 } }, now)).toEqual({
      title: 'Up to date',
      tone: 'ok',
      line: '4 clips and 3 shorts in nimbytes · checked 2 min ago',
      spaceUsed: '0 bytes',
      folder: '~/nimbytes',
    });
  });

  it('uses singular words, says when nothing was checked yet, and shows the cache size', () => {
    const view = syncPanelView(
      { ...status, state: 'syncing', lastSyncAt: null, counts: { clips: 1, shorts: 1, originalsOffline: 0 }, cacheBytes: 38_000_000 },
      now,
    );

    expect(view).toEqual({
      title: 'Syncing',
      tone: 'busy',
      line: '1 clip and 1 short in nimbytes · not checked yet',
      spaceUsed: '38 MB',
      folder: '~/nimbytes',
    });
  });
});

describe('spaceUsedLabel', () => {
  it('says "0 bytes" for nothing, else a compact size', () => {
    expect(spaceUsedLabel(0)).toBe('0 bytes');
    expect(spaceUsedLabel(1_200_000_000)).toBe('1.2 GB');
    expect(spaceUsedLabel(512)).toBe('512 B');
  });
});

describe('serverOrigin and syncProblem', () => {
  it('names the server by its origin, as typed when not a URL, or "your server"', () => {
    expect(serverOrigin('https://localhost/some/path')).toBe('https://localhost');
    expect(serverOrigin('box')).toBe('box');
    expect(serverOrigin(null)).toBe('your server');
  });

  it('builds the problem line from the state and server only', () => {
    expect(syncProblem('offline', 'https://localhost')).toBe('Can’t reach https://localhost');
    expect(syncProblem('error', 'https://box.example')).toBe('Sync stopped');
    expect(syncProblem('idle', 'https://localhost')).toBeNull();
    expect(syncProblem('syncing', null)).toBeNull();
  });

  it('shows the readable NETWORK message as sent, and falls back for any other native text', () => {
    expect(syncProblem('offline', 'https://a.example', 'Can\'t reach https://3-104-132-162.sslip.io (timed out)')).toBe(
      'Can\'t reach https://3-104-132-162.sslip.io (timed out)',
    );
    expect(syncProblem('offline', 'https://a.example', 'error sending request for url (https://a.example/api)')).toBe(
      'Can’t reach https://a.example',
    );
    expect(syncProblem('error', 'https://a.example', 'Can\'t reach https://a.example')).toBe('Sync stopped');
  });

  it('never carries the native error text into the page', () => {
    const raw = 'error sending request for url (https://localhost/api/sync/manifest)';
    const view = syncPanelView({ ...status, state: 'offline', error: raw }, now);

    expect(JSON.stringify(view)).not.toContain('error sending request');
  });
});
