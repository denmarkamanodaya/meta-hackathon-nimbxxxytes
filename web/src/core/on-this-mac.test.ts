import { describe, expect, it } from 'vitest';
import type { SyncStatus } from './desktop-sync';
import { clipAvailability, meterStatus, nextStripPhase, onThisMacView, secondsUntilFreed } from './on-this-mac';

const now = new Date('2026-10-27T10:00:00Z');

const status = (over: Partial<SyncStatus> = {}): SyncStatus => ({
  folder: '/Users/me/nimbytes',
  lastSyncAt: '2026-10-27T09:58:00Z',
  state: 'idle',
  error: null,
  counts: { clips: 4, shorts: 1, originalsOffline: 0 },
  pinnedClipIds: [],
  cache: { budgetGb: 5, autoBytes: 0 },
  cacheBytes: 0,
  transfers: [],
  exports: [],
  local: { proxyClipIds: [], proxyBytes: 0, originalClipIds: [], pinnedBytes: 0, renders: 0, projects: 0, clips: [] },
  pollS: 30,
  cacheCapBytes: 5_000_000_000,
  releaseAfterS: 180,
  ...over,
});

describe('clipAvailability', () => {
  const drive = status({
    pinnedClipIds: ['park', 'new'],
    local: {
      proxyClipIds: [],
      proxyBytes: 0,
      originalClipIds: [],
      pinnedBytes: 0,
      renders: 0,
      projects: 0,
      clips: [
        { clipId: 'park', cachedBytes: 3_400_000_000, lastReadAt: null },
        { clipId: 'kitchen', cachedBytes: 41_000_000, lastReadAt: '2026-10-27T09:59:40Z' },
        { clipId: 'walk', cachedBytes: 0, lastReadAt: null },
      ],
    },
  });

  it('is kept when pinned, even before its bytes arrive', () => {
    expect(clipAvailability('park', drive)).toBe('kept');
    expect(clipAvailability('new', drive)).toBe('kept');
  });

  it('is cached while the drive holds some of it, else in the cloud', () => {
    expect(clipAvailability('kitchen', drive)).toBe('cached');
    expect(clipAvailability('walk', drive)).toBe('cloud');
    expect(clipAvailability('unknown', drive)).toBe('cloud');
  });

  it('is in the cloud while the status loads', () => {
    expect(clipAvailability('park', null)).toBe('cloud');
  });
});

describe('secondsUntilFreed', () => {
  it('counts down from the last read plus the release time', () => {
    expect(secondsUntilFreed('2026-10-27T09:59:40Z', 180, now)).toBe(160);
    expect(secondsUntilFreed('2026-10-27T10:00:00Z', 180, now)).toBe(180);
  });

  it('rounds a part second up and never goes below zero', () => {
    expect(secondsUntilFreed('2026-10-27T09:57:00.500Z', 180, now)).toBe(1);
    expect(secondsUntilFreed('2026-10-27T09:50:00Z', 180, now)).toBe(0);
  });

  it('is unknown without a last read, a release time or a readable instant', () => {
    expect(secondsUntilFreed(null, 180, now)).toBeNull();
    expect(secondsUntilFreed('2026-10-27T09:59:40Z', null, now)).toBeNull();
    expect(secondsUntilFreed('yesterday', 180, now)).toBeNull();
  });
});

describe('nextStripPhase', () => {
  it('lights "while you watch" while anything plays', () => {
    expect(nextStripPhase('before', true)).toBe('during');
    expect(nextStripPhase('after', true)).toBe('during');
  });

  it('lights "3 minutes later" once the played bytes are freed, until the next play', () => {
    expect(nextStripPhase('during', false)).toBe('after');
    expect(nextStripPhase('after', false)).toBe('after');
  });

  it('stays on "before you play" when nothing has played', () => {
    expect(nextStripPhase('before', false)).toBe('before');
  });
});

describe('onThisMacView', () => {
  it('says nothing is stored at 0 bytes', () => {
    const view = onThisMacView(status(), now);

    expect(view).toMatchObject({
      spaceUsed: '0 bytes',
      keptPercent: 0,
      playingPercent: 0,
      capLine: 'Cache limit 5 GB · frees early when your Mac is under 15% free',
      stateLines: ['Nothing stored'],
      isPlaying: false,
      playing: [],
      kept: [],
      releaseMinutes: 3,
    });
  });

  it('splits kept (pinned) from playing bytes, and counts the playing clip down', () => {
    const view = onThisMacView(
      status({
        pinnedClipIds: ['park'],
        cacheBytes: 3_441_000_000,
        local: {
          proxyClipIds: [],
          proxyBytes: 0,
          originalClipIds: ['park'],
          pinnedBytes: 3_400_000_000,
          renders: 0,
          projects: 0,
          clips: [
            { clipId: 'park', cachedBytes: 3_400_000_000, lastReadAt: '2026-10-27T09:00:00Z' },
            { clipId: 'kitchen', cachedBytes: 41_000_000, lastReadAt: '2026-10-27T09:59:40Z' },
            { clipId: 'walk', cachedBytes: 0, lastReadAt: null },
          ],
        },
      }),
      now,
    );

    expect(view.spaceUsed).toBe('3.4 GB');
    expect(view.kept).toEqual([{ clipId: 'park', bytes: 3_400_000_000 }]);
    expect(view.playing).toEqual([{ clipId: 'kitchen', bytes: 41_000_000, freesInS: 160 }]);
    expect(view.stateLines).toEqual(['3.4 GB kept offline', '41 MB playing · frees in 2:40']);
    expect(view.keptPercent).toBeCloseTo(68);
    expect(view.playingPercent).toBeCloseTo(0.82);
    expect(view.isPlaying).toBe(true);
  });

  it('lists a pinned clip whose original is still downloading with 0 bytes', () => {
    expect(onThisMacView(status({ pinnedClipIds: ['new'] }), now).kept).toEqual([{ clipId: 'new', bytes: 0 }]);
  });

  it('leaves out the countdown and cap line when the native side does not report them', () => {
    const view = onThisMacView(
      status({
        cacheCapBytes: 0,
        releaseAfterS: null,
        local: {
          proxyClipIds: [],
          proxyBytes: 0,
          originalClipIds: [],
          pinnedBytes: 0,
          renders: 0,
          projects: 0,
          clips: [{ clipId: 'kitchen', cachedBytes: 41_000_000, lastReadAt: '2026-10-27T09:59:40Z' }],
        },
      }),
      now,
    );

    expect(view.capLine).toBe('');
    expect(view.stateLines).toEqual(['41 MB playing']);
    expect(view.playingPercent).toBe(0);
    expect(view.releaseMinutes).toBe(3);
  });
});

describe('meterStatus', () => {
  it('says up to date and when, with a still dot', () => {
    expect(meterStatus(status(), now, 'UTC')).toEqual({ line: 'Up to date · 2 min ago', tone: 'ok', isBusy: false });
    expect(meterStatus(status({ lastSyncAt: null }), now, 'UTC').line).toBe('Up to date');
  });

  it('pulses only while syncing, and names the other states', () => {
    expect(meterStatus(status({ state: 'syncing' }), now)).toEqual({ line: 'Syncing…', tone: 'busy', isBusy: true });
    expect(meterStatus(status({ state: 'offline' }), now)).toEqual({ line: 'Offline', tone: 'warn', isBusy: false });
    expect(meterStatus(status({ state: 'error' }), now)).toEqual({ line: 'Sync stopped', tone: 'error', isBusy: false });
  });
});
