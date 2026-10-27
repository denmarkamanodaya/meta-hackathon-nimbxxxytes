import { describe, expect, it } from 'vitest';
import {
  bytePair,
  clipDiskState,
  displayFolder,
  lastSyncLabel,
  serverOrigin,
  syncProblem,
  sidebarStatus,
  storageTiles,
  syncHeadline,
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

describe('sidebarStatus and syncHeadline', () => {
  it('match the mocks: "Synced" + "2 min ago · ~/nimbytes", and "Up to date · checked 2 min ago · every 30 s"', () => {
    expect(sidebarStatus(status, now)).toEqual({ label: 'Synced', tone: 'ok', line: '2 min ago · ~/nimbytes' });
    expect(syncHeadline(status, now)).toBe('Up to date · checked 2 min ago · every 30 s');
  });

  it('drops the interval when not reported and says when nothing synced yet', () => {
    const fresh = { ...status, lastSyncAt: null, pollS: null, state: 'syncing' as const };

    expect(syncHeadline(fresh, now)).toBe('Syncing · not checked yet');
    expect(sidebarStatus(fresh, now)).toEqual({ label: 'Syncing…', tone: 'busy', line: 'Not synced yet · ~/nimbytes' });
  });
});

describe('storageTiles', () => {
  it('builds the three M1 tiles from storage, the sync status and the ready clips', () => {
    expect(storageTiles({ bytes: 125_000_000, clips: 4 }, status, ['c1', 'c2', 'c3', 'c4'])).toEqual([
      { label: 'In your cloud', value: '125 MB', line: '4 clips · originals tier themselves', isAccent: false },
      { label: 'On this Mac', value: '38 MB', line: '3 of 4 clips play from disk', isAccent: true },
      { label: 'Originals offline', value: '1', line: '48 MB of a 20 GB budget', isAccent: false },
    ]);
  });

  it('shows a dash while a source is missing', () => {
    expect(storageTiles(null, null, []).map((tile) => [tile.value, tile.line])).toEqual([
      ['—', ''],
      ['—', ''],
      ['—', ''],
    ]);
  });
});

describe('clipDiskState', () => {
  it('gives Original offline, On Mac, syncing with progress, and cloud', () => {
    const syncing = { ...status, transfers: [transfer({})] };

    expect(clipDiskState('c2', syncing)).toEqual({ kind: 'original', badge: 'Original', line: 'Original offline' });
    expect(clipDiskState('c1', syncing)).toEqual({ kind: 'on-mac', badge: 'On Mac', line: 'Proxy on disk' });
    expect(clipDiskState('c4', syncing)).toEqual({ kind: 'syncing', percent: 41, line: 'Streams from cloud until synced' });
    expect(clipDiskState('c9', syncing)).toEqual({ kind: 'cloud', line: 'Streams from cloud until synced' });
  });

  it('calls an unpinned original on disk cached, and shows nothing local before the status loads', () => {
    const cached = { ...status, local: { ...status.local, originalClipIds: ['c1'] } };

    expect(clipDiskState('c1', cached)).toMatchObject({ badge: 'Original', line: 'Original cached for editing' });
    expect(clipDiskState('c1', null).kind).toBe('cloud');
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
  it('builds the M3 folder counts, cache split and export labels', () => {
    const view = syncPanelView(
      {
        ...status,
        exports: [
          { name: 'morning-reel-final.mov', state: 'uploading', error: null },
          { name: 'dog-cut.mp4', state: 'uploaded', error: null },
          { name: 'dog-cut copy.mp4', state: 'duplicate', error: null },
        ],
      },
      now,
    );

    expect(view.folder).toBe('~/nimbytes');
    expect(view.folderCounts).toEqual([
      { label: 'Library', value: '4 clips' },
      { label: 'Originals', value: '1 offline' },
      { label: 'Shorts', value: '4 renders' },
      { label: 'Projects', value: '1 FCPXML' },
    ]);
    expect(view.cache).toEqual({
      keptPercent: 0.24,
      cachedPercent: 0.48,
      kept: 'Kept offline 48 MB',
      cached: 'Cached for editing 96 MB',
      budgetGb: 20,
    });
    expect(view.exports.map((row) => [row.label, row.tone])).toEqual([
      ['Uploading', 'busy'],
      ['In your library', 'ok'],
      ['Already uploaded, skipped', 'muted'],
    ]);
  });

  it('caps the cached share so the bar never overflows', () => {
    const full = { ...status, cache: { budgetGb: 1, autoBytes: 900_000_000 }, local: { ...status.local, pinnedBytes: 300_000_000 } };

    expect(syncPanelView(full, now).cache).toMatchObject({ keptPercent: 30, cachedPercent: 70 });
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
    const view = syncPanelView(
      { ...status, state: 'offline', error: raw, exports: [{ name: 'a.mp4', state: 'failed', error: raw }] },
      now,
    );

    expect(JSON.stringify(view)).not.toContain('error sending request');
  });
});
