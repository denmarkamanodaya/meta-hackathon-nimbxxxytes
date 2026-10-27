import { describe, expect, it } from 'vitest';
import type { SyncExport, SyncStatus, SyncTransfer } from './desktop-sync';
import {
  advanceTally,
  EMPTY_TALLY,
  galleryUploads,
  isPickedUpload,
  timeLeftLabel,
  uploadingLine,
} from './gallery-uploads';

const up = (over: Partial<SyncTransfer>): SyncTransfer => ({
  id: 'Export:/Users/me/Movies/VID_1.mp4',
  kind: 'export',
  name: 'VID_1.mp4',
  doneBytes: 896_000_000,
  totalBytes: 1_400_000_000,
  direction: 'up',
  clipId: 'c1',
  ...over,
});

const statusWith = (transfers: SyncTransfer[], exports: SyncExport[] = []): SyncStatus => ({
  folder: '/Users/me/nimbytes',
  lastSyncAt: null,
  state: 'syncing',
  error: null,
  counts: { clips: 0, shorts: 0, originalsOffline: 0 },
  pinnedClipIds: [],
  cache: { budgetGb: 20, autoBytes: 0 },
  cacheBytes: 0,
  transfers,
  exports,
  local: { proxyClipIds: [], proxyBytes: 0, originalClipIds: [], pinnedBytes: 0, renders: 0, projects: 0, clips: [] },
  pollS: null,
  cacheCapBytes: 0,
  releaseAfterS: null,
});

describe('galleryUploads', () => {
  it('shows each upload going up with its percent, Waiting before bytes move, and its size', () => {
    const uploads = galleryUploads(
      statusWith([
        up({ id: 'Export:/m/VID_2.mp4', name: 'VID_2.mp4', doneBytes: 0, totalBytes: 900_000_000 }),
        up({}),
        up({ id: 'proxy:c9', kind: 'proxy', direction: 'down', name: 'Beach.mp4' }),
      ]),
    );

    expect(uploads.map((u) => [u.name, u.state, u.label, u.percent, u.size])).toEqual([
      ['VID_1.mp4', 'uploading', 'Uploading 64%', 64, '1.4 GB'],
      ['VID_2.mp4', 'waiting', 'Waiting', 0, '900 MB'],
    ]);
  });

  it('adds waiting and failed export rows that have no transfer, and skips sent ones', () => {
    const uploads = galleryUploads(
      statusWith(
        [up({})],
        [
          { name: 'VID_1.mp4', state: 'uploading', error: null },
          { name: 'Edit.mov', state: 'waiting', error: null },
          { name: 'Old.mp4', state: 'failed', error: 'The server refused the file' },
          { name: 'Done.mp4', state: 'uploaded', error: null },
          { name: 'Same.mp4', state: 'duplicate', error: null },
        ],
      ),
    );

    expect(uploads.map((u) => [u.key, u.state, u.label, u.cancelId])).toEqual([
      ['Export:/Users/me/Movies/VID_1.mp4', 'uploading', 'Uploading 64%', 'Export:/Users/me/Movies/VID_1.mp4'],
      ['export:Edit.mov', 'waiting', 'Waiting', null],
      ['export:Old.mp4', 'failed', 'Upload failed', null],
    ]);
    expect(uploads[2]?.error).toBe('The server refused the file');
  });

  it('hides transfers cancelled here, and is empty while the status loads', () => {
    expect(galleryUploads(statusWith([up({})]), new Set(['Export:/Users/me/Movies/VID_1.mp4']))).toEqual([]);
    expect(galleryUploads(null)).toEqual([]);
  });

  it('offers cancel only for picked uploads, not for files dropped in the Exports folder', () => {
    expect(isPickedUpload('Export:/Users/me/Movies/VID_1.mp4')).toBe(true);
    expect(isPickedUpload('Export:Final cut.mov')).toBe(false);
    const [dropped] = galleryUploads(statusWith([up({ id: 'Export:Final cut.mov', name: 'Final cut.mov' })]));
    expect(dropped?.cancelId).toBeNull();
  });
});

describe('timeLeftLabel', () => {
  it('rounds to minutes, says less than a minute under 60 s, and hours from 90 min', () => {
    expect(timeLeftLabel(1_200_000_000, 6_700_000)).toBe('about 3 min left');
    expect(timeLeftLabel(50_000_000, 1_000_000)).toBe('less than a minute left');
    expect(timeLeftLabel(60_000_000, 1_000_000)).toBe('about 1 min left');
    expect(timeLeftLabel(5_400_000_000, 1_000_000)).toBe('about 1.5 h left');
    expect(timeLeftLabel(7_200_000_000, 1_000_000)).toBe('about 2 h left');
  });

  it('is null when the speed is unknown or zero', () => {
    expect(timeLeftLabel(1_000, null)).toBeNull();
    expect(timeLeftLabel(1_000, 0)).toBeNull();
  });
});

describe('uploadingLine', () => {
  const uploads = galleryUploads(
    statusWith([
      up({ doneBytes: 1_100_000_000, totalBytes: 1_400_000_000 }),
      up({ id: 'Export:/m/VID_2.mp4', name: 'VID_2.mp4', doneBytes: 0, totalBytes: 900_000_000 }),
    ]),
  );

  it('counts the clips, the bytes in the total’s unit and the time left', () => {
    expect(uploadingLine(uploads, 6_700_000)).toBe('Uploading 2 clips · 1.1 of 2.3 GB · about 3 min left');
  });

  it('leaves out the time while the speed is unknown, and the bytes while no size is known', () => {
    expect(uploadingLine(uploads, null)).toBe('Uploading 2 clips · 1.1 of 2.3 GB');
    const sizeless = galleryUploads(statusWith([], [{ name: 'Edit.mov', state: 'waiting', error: null }]));
    expect(uploadingLine(sizeless, 1_000_000)).toBe('Uploading 1 clip');
  });

  it('is null when only failed uploads are left, or none', () => {
    const failed = galleryUploads(statusWith([], [{ name: 'Old.mp4', state: 'failed', error: 'x' }]));
    expect(uploadingLine(failed, null)).toBeNull();
    expect(uploadingLine([], null)).toBeNull();
  });
});

describe('advanceTally', () => {
  it('adds the bytes each transfer sent since the last status', () => {
    const first = advanceTally(EMPTY_TALLY, [up({ id: 'a', doneBytes: 100 }), up({ id: 'b', doneBytes: 0 })]);
    const second = advanceTally(first, [up({ id: 'a', doneBytes: 300 }), up({ id: 'b', doneBytes: 50 })]);

    expect(first.sent).toBe(0);
    expect(second.sent).toBe(250);
  });

  it('never counts backwards when an upload finishes and leaves the list, or restarts', () => {
    const first = advanceTally(EMPTY_TALLY, [up({ id: 'a', doneBytes: 900 }), up({ id: 'b', doneBytes: 0 })]);
    const finished = advanceTally(first, [up({ id: 'b', doneBytes: 40 })]);
    const restarted = advanceTally(finished, [up({ id: 'b', doneBytes: 10 })]);

    expect(finished.sent).toBe(40);
    expect(restarted.sent).toBe(40);
  });

  it('starts over when nothing goes up, ignoring downloads', () => {
    const first = advanceTally(EMPTY_TALLY, [up({ id: 'a', doneBytes: 100 })]);

    expect(advanceTally(first, [up({ id: 'd', direction: 'down' })])).toEqual(EMPTY_TALLY);
  });
});
