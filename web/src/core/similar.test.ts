import { describe, expect, it } from 'vitest';
import type { ClipLink, ClipSummary } from '../services/api/types';
import {
  angleRowLine,
  anglesLabel,
  anglesLine,
  anglesNote,
  apartWords,
  copiedByLine,
  copiesHeadLine,
  copiesIn,
  copiesRemovedTitle,
  copiesSizeLine,
  copyCountParts,
  copySentence,
  looksTrimmed,
  originalLink,
  removeCopiesCopy,
  sameMomentLinks,
  tileBadge,
} from './similar';

const TZ = 'UTC';

const clip = (over: Partial<ClipSummary>): ClipSummary => ({
  clip_id: 'c',
  title: 'Clip',
  filename: 'c.mp4',
  duration_s: 30,
  recorded_at: null,
  status: 'ready',
  thumb_url: null,
  segment_count: 3,
  people: [],
  duplicate_of: null,
  near_copy_of: null,
  angles: 0,
  size_bytes: 600_000_000,
  project_ids: [],
  speech_count: 0,
  face_count: 0,
  ...over,
});

const link = (over: Partial<ClipLink>): ClipLink => ({
  clip_id: 'o',
  title: 'Beach walk, Koh Samui',
  kind: 'near_copy_of',
  score: 0.94,
  recorded_at: '2026-10-20T10:00:00Z',
  thumb_url: null,
  duration_s: 108,
  ...over,
});

const NEAR = { clip_id: 'o', title: 'Beach walk', score: 0.94 };

describe('tileBadge', () => {
  it('names a duplicate and a near-copy in the copy tone', () => {
    expect(tileBadge(clip({ status: 'duplicate', duplicate_of: 'o' }))).toEqual({ label: 'Duplicate', tone: 'copy' });
    expect(tileBadge(clip({ status: 'near_copy', near_copy_of: NEAR }))).toEqual({ label: 'Near-copy', tone: 'copy' });
  });

  it('badges a ready clip the backfill linked to an older one as a near-copy', () => {
    expect(tileBadge(clip({ status: 'ready', near_copy_of: NEAR }))).toEqual({ label: 'Near-copy', tone: 'copy' });
  });

  it('counts the clip itself in "2 angles" (accent), and a copy wins over angles', () => {
    expect(tileBadge(clip({ angles: 1 }))).toEqual({ label: '2 angles', tone: 'angles' });
    expect(anglesLabel(2)).toBe('3 angles');
    expect(tileBadge(clip({ angles: 1, near_copy_of: NEAR }))?.label).toBe('Near-copy');
  });

  it('gives a plain clip no badge', () => {
    expect(tileBadge(clip({}))).toBeNull();
  });
});

describe('the Copies view', () => {
  const plain = clip({ clip_id: 'a' });
  const dup = clip({ clip_id: 'c', status: 'duplicate', duplicate_of: 'a' });
  const library = [plain, clip({ clip_id: 'b', status: 'near_copy', near_copy_of: NEAR }), dup, clip({ clip_id: 'd', near_copy_of: NEAR })];

  it('lists duplicates, near-copies and ready clips with a near-copy link, in order', () => {
    expect(copiesIn(library).map((c) => c.clip_id)).toEqual(['b', 'c', 'd']);
  });

  it('says how much the copies take and that the originals stay', () => {
    expect(copiesSizeLine(copiesIn(library))).toBe('3 copies use 1.8 GB. Removing them keeps the originals.');
    expect(copiesSizeLine([clip({ size_bytes: 400_000_000 })])).toBe('1 copy uses 400 MB. Removing it keeps the original.');
  });

  it('heads the view with the copy count', () => {
    expect(copiesHeadLine(3)).toBe('3 copies of other clips');
    expect(copiesHeadLine(1)).toBe('1 copy of another clip');
  });

  it('counts near-copies and duplicates apart for the header, leaving out zeros', () => {
    expect(copyCountParts(library)).toEqual(['2 near-copies', '1 duplicate']);
    expect(copyCountParts([plain, dup])).toEqual(['1 duplicate']);
    expect(copyCountParts([plain])).toEqual([]);
  });

  it('asks before removing and reports how it went', () => {
    expect(removeCopiesCopy(3).confirmLabel).toBe('Remove 3 copies');
    expect(removeCopiesCopy(1).title).toBe('Remove this copy?');
    expect(copiesRemovedTitle(3, 0)).toBe('3 copies removed');
    expect(copiesRemovedTitle(1, 0)).toBe('Copy removed');
    expect(copiesRemovedTitle(2, 1)).toBe('Could not remove 1 of 3 copies');
    expect(copiesRemovedTitle(0, 1)).toBe('Could not remove the copy');
  });
});

describe('the copy box', () => {
  it('reads "94% the same as … (1:48), filmed 20 Oct." with the trimmed hint when shorter', () => {
    expect(copySentence(58, link({}), TZ)).toEqual({
      before: '94% the same as ',
      title: 'Beach walk, Koh Samui',
      after: ' (1:48), filmed 20 Oct.',
      trimmed: 'This one is shorter: it looks trimmed.',
    });
  });

  it('drops the hint for a same-length or longer copy, and unknown parts', () => {
    const sentence = copySentence(108, link({ recorded_at: null, duration_s: null, score: 0.912 }), TZ);

    expect(sentence).toEqual({ before: '91% the same as ', title: 'Beach walk, Koh Samui', after: '.', trimmed: null });
  });

  it('calls a copy trimmed only when clearly shorter (≥ 1 s and over 5%)', () => {
    expect(looksTrimmed(18, 30)).toBe(true);
    expect(looksTrimmed(29.5, 30)).toBe(false);
    expect(looksTrimmed(100, 104)).toBe(false);
    expect(looksTrimmed(32, 30)).toBe(false);
    expect(looksTrimmed(null, 30)).toBe(false);
  });

  it('finds the original among the links, and the original names its copies', () => {
    const links = [link({ kind: 'same_moment', clip_id: 's' }), link({ clip_id: 'o' })];

    expect(originalLink(links)?.clip_id).toBe('o');
    expect(originalLink([])).toBeNull();
    expect(sameMomentLinks(links).map((l) => l.clip_id)).toEqual(['s']);
    expect(copiedByLine([link({ kind: 'copied_by' })])).toBe('1 copy of this clip');
    expect(copiedByLine([link({ kind: 'copied_by' }), link({ kind: 'copied_by' })])).toBe('2 copies of this clip');
    expect(copiedByLine(links)).toBeNull();
  });
});

describe('the angles box', () => {
  it('says how far apart in seconds under a minute, else minutes', () => {
    expect(apartWords(40)).toBe('40 seconds apart');
    expect(apartWords(-1)).toBe('1 second apart');
    expect(apartWords(59.4)).toBe('59 seconds apart');
    expect(apartWords(60)).toBe('1 minute apart');
    expect(apartWords(200)).toBe('3 minutes apart');
  });

  it('reads "Also filmed on another device, 40 seconds apart."', () => {
    const other = link({ kind: 'same_moment', recorded_at: '2026-10-20T18:12:40Z' });

    expect(anglesLine('2026-10-20T18:12:00Z', [other])).toBe('Also filmed on another device, 40 seconds apart.');
  });

  it('gives the widest gap for several links, and no gap when a time is unknown', () => {
    const a = link({ kind: 'same_moment', recorded_at: '2026-10-20T18:12:40Z' });
    const b = link({ kind: 'same_moment', recorded_at: '2026-10-20T18:09:00Z' });

    expect(anglesLine('2026-10-20T18:12:00Z', [a, b])).toBe('Also filmed on 2 other devices, up to 3 minutes apart.');
    expect(anglesLine(null, [a])).toBe('Also filmed on another device.');
    expect(anglesLine('2026-10-20T18:12:00Z', [link({ kind: 'same_moment', recorded_at: null })])).toBe('Also filmed on another device.');
  });

  it('notes both (or all) angles stay searchable', () => {
    expect(anglesNote(2)).toBe('Both stay in your library and in search. A short can use either angle.');
    expect(anglesNote(3)).toContain('any angle');
  });

  it('lines each clip of the moment as "Filmed 20 Oct, 18:12 · 0:52"', () => {
    expect(angleRowLine('2026-10-20T18:12:00Z', 52, TZ)).toBe('Filmed 20 Oct, 18:12 · 0:52');
    expect(angleRowLine(null, 65, TZ)).toBe('1:05');
    expect(angleRowLine(null, null, TZ)).toBe('');
  });
});
