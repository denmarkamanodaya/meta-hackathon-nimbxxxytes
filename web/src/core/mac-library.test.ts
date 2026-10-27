import { describe, expect, it } from 'vitest';
import type { ClipSummary } from '../services/api/types';
import { filterClips, filterLabel, readyTileLine } from './mac-library';

const clip = (clip_id: string, status: ClipSummary['status'], over: Partial<ClipSummary> = {}): ClipSummary => ({
  clip_id,
  title: clip_id,
  filename: `${clip_id}.mp4`,
  duration_s: 28,
  recorded_at: '2026-10-27T08:00:00Z',
  status,
  thumb_url: null,
  segment_count: 3,
  people: [],
  duplicate_of: null,
  size_bytes: 0,
  project_ids: [],
  speech_count: 0,
  face_count: 0,
  ...over,
});

const library = [
  clip('kitchen', 'ready'),
  clip('walk', 'ready'),
  clip('office', 'processing'),
  clip('park', 'uploaded'),
  clip('copy', 'duplicate'),
];

describe('filterClips', () => {
  it('shows everything, the kept clips, the ones getting ready, or the duplicates', () => {
    const ids = (filter: Parameters<typeof filterClips>[1]) => filterClips(library, filter, ['walk']).map((c) => c.clip_id);

    expect(ids('all')).toEqual(['kitchen', 'walk', 'office', 'park', 'copy']);
    expect(ids('kept')).toEqual(['walk']);
    expect(ids('getting-ready')).toEqual(['office', 'park']);
    expect(ids('duplicates')).toEqual(['copy']);
  });
});

describe('filterLabel', () => {
  it('always counts All, and counts the others only when they hold something', () => {
    expect(filterLabel('all', library, [])).toBe('All 5');
    expect(filterLabel('kept', library, [])).toBe('Kept offline');
    expect(filterLabel('kept', library, ['walk'])).toBe('Kept offline 1');
    expect(filterLabel('getting-ready', library, [])).toBe('Getting ready 2');
    expect(filterLabel('duplicates', library, [])).toBe('Duplicates 1');
  });
});

describe('readyTileLine', () => {
  const now = new Date('2026-10-27T10:00:00Z');

  it('says a kept clip is kept, with its size once it is on this Mac', () => {
    const kept = { availability: 'kept' as const, releaseAfterS: 180 };
    expect(readyTileLine(clip('park', 'ready'), { ...kept, drive: { clipId: 'park', cachedBytes: 3_400_000_000, lastReadAt: null } }, now)).toBe(
      'Kept offline · 3.4 GB',
    );
    expect(readyTileLine(clip('park', 'ready'), { ...kept, drive: undefined }, now)).toBe('Kept offline');
  });

  it('says when a played clip is freed', () => {
    const played = (lastReadAt: string) =>
      readyTileLine(
        clip('kitchen', 'ready'),
        { availability: 'cached', drive: { clipId: 'kitchen', cachedBytes: 41_000_000, lastReadAt }, releaseAfterS: 180 },
        now,
      );

    expect(played('2026-10-27T09:59:40Z')).toBe('Played just now · frees in 2:40');
    expect(played('2026-10-27T09:58:00Z')).toBe('Played 2 min ago · frees in 1:00');
  });

  it('leaves the countdown out when the release time is unknown', () => {
    expect(
      readyTileLine(clip('kitchen', 'ready'), { availability: 'cached', drive: { clipId: 'kitchen', cachedBytes: 1, lastReadAt: '2026-10-27T09:59:40Z' }, releaseAfterS: null }, now),
    ).toBe('Played just now');
  });

  it('gives a clip in the cloud its day and people', () => {
    const where = { availability: 'cloud' as const, drive: undefined, releaseAfterS: 180 };

    expect(readyTileLine(clip('walk', 'ready', { people: ['Sam', 'Leo'] }), where, now, 'UTC')).toBe('Today · Sam, Leo');
    expect(readyTileLine(clip('walk', 'ready'), where, now, 'UTC')).toBe('Today');
    expect(readyTileLine(clip('walk', 'ready', { recorded_at: null, people: ['Sam'] }), where, now, 'UTC')).toBe('Sam');
  });
});
