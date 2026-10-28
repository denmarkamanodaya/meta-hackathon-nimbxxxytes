import { describe, expect, it } from 'vitest';
import type { ClipSummary, Project } from '../services/api/types';
import {
  availabilityLine,
  panelMetaLine,
  galleryClips,
  galleryHeaderLine,
  galleryRow,
  gridColumns,
  parseGallerySize,
  parseGalleryView,
  projectNames,
  tileLine,
  type AvailabilityOf,
} from './gallery';

const clip = (clip_id: string, over: Partial<ClipSummary> = {}): ClipSummary => ({
  clip_id,
  title: clip_id,
  filename: `${clip_id}.mp4`,
  duration_s: 16,
  recorded_at: '2026-10-26T08:00:00Z',
  status: 'ready',
  thumb_url: null,
  segment_count: 2,
  people: [],
  duplicate_of: null,
  size_bytes: 3_700_000,
  project_ids: [],
  speech_count: 0,
  face_count: 0,
  ...over,
});

const projects: Project[] = [
  { project_id: 'p_b', name: '60th birthday', color: 'orange', clip_count: 1, duration_s: 327, size_bytes: 1, created_at: '2026-10-27T00:00:00Z', art_url: null, art_drawing: false, art_sources: [] },
  { project_id: 'p_t', name: 'Australia trip', color: 'green', clip_count: 2, duration_s: 34, size_bytes: 1, created_at: '2026-10-26T00:00:00Z', art_url: null, art_drawing: false, art_sources: [] },
];

const dog = clip('dog', { title: 'Sleepy old dog', project_ids: ['p_t'], recorded_at: '2026-10-26T09:00:00Z' });
const party = clip('party', {
  title: '60th birthday celebration',
  duration_s: 327,
  recorded_at: '2026-08-19T12:00:00Z',
  segment_count: 46,
  face_count: 35,
  speech_count: 11,
  size_bytes: 3_400_000_000,
  project_ids: ['p_b'],
});
const log = clip('log', { title: 'Terminal log review', recorded_at: null, duration_s: 21 });
const all = [dog, party, log];
const where: AvailabilityOf = (id) => (id === 'dog' ? 'kept' : id === 'party' ? 'cached' : 'cloud');

describe('galleryClips', () => {
  const ids = (list: ClipSummary[]) => list.map((c) => c.clip_id);

  it('filters by place, speech, faces and projects', () => {
    expect(ids(galleryClips(all, 'all', 'newest', where))).toEqual(['dog', 'party', 'log']);
    expect(ids(galleryClips(all, 'on-mac', 'newest', where))).toEqual(['dog', 'party']);
    expect(ids(galleryClips(all, 'kept', 'newest', where))).toEqual(['dog']);
    expect(ids(galleryClips(all, 'speech', 'newest', where))).toEqual(['party']);
    expect(ids(galleryClips(all, 'faces', 'newest', where))).toEqual(['party']);
    expect(ids(galleryClips(all, 'no-project', 'newest', where))).toEqual(['log']);
  });

  it('sorts newest or oldest with undated clips last, longest, and by name', () => {
    expect(ids(galleryClips(all, 'all', 'oldest', where))).toEqual(['party', 'dog', 'log']);
    expect(ids(galleryClips(all, 'all', 'longest', where))).toEqual(['party', 'log', 'dog']);
    expect(ids(galleryClips(all, 'all', 'name', where))).toEqual(['party', 'dog', 'log']);
  });

  it('never reorders the list it was given', () => {
    galleryClips(all, 'all', 'name', where);
    expect(ids(all)).toEqual(['dog', 'party', 'log']);
  });
});

describe('prefs', () => {
  it('reads a stored view and size, falling back to grid and the middle step', () => {
    expect(parseGalleryView('list')).toBe('list');
    expect(parseGalleryView('table')).toBe('grid');
    expect(parseGalleryView(null)).toBe('grid');
    expect(parseGallerySize('5')).toBe(5);
    expect(parseGallerySize('9')).toBe(3);
    expect(parseGallerySize('2.5')).toBe(3);
    expect(parseGallerySize(null)).toBe(3);
  });

  it('shows five columns at the default size, fewer as tiles grow', () => {
    expect(gridColumns(3)).toBe(5);
    expect(gridColumns(1)).toBeGreaterThan(gridColumns(5));
  });
});

describe('words', () => {
  it('counts clips and their size in the header, duplicates left out, with the cap when known', () => {
    const copy = clip('copy', { status: 'duplicate', size_bytes: 9_000_000_000 });

    expect(galleryHeaderLine([dog, party, copy], null)).toBe('2 clips · 3.4 GB in the cloud');
    expect(galleryHeaderLine([dog], 'of 250 GB')).toBe('1 clip · 3.7 MB of 250 GB in the cloud');
  });

  it('prints the tile line with the full date', () => {
    expect(tileLine(party, 'UTC')).toBe('19 Aug 2026 · 46 moments');
    expect(tileLine(clip('x', { recorded_at: null, segment_count: 1 }), 'UTC')).toBe('1 moment');
  });

  it('fills a list row, with a dash for no moments, no faces and no project', () => {
    expect(galleryRow(party, 'cached', projects, 'UTC')).toEqual({
      name: '60th birthday celebration',
      recorded: '19 Aug 2026',
      length: '5:27',
      size: '3.4 GB',
      moments: '46',
      faces: '35',
      where: 'Partly on this Mac',
      project: '60th birthday',
    });
    expect(galleryRow(log, 'cloud', projects, 'UTC')).toMatchObject({ recorded: '—', faces: '—', where: 'In the cloud', project: '—' });
    expect(galleryRow(clip('fresh', { segment_count: 0 }), 'cloud', projects, 'UTC').moments).toBe('—');
  });

  it('prints the right column meta line, with the project only when there is one', () => {
    expect(panelMetaLine(party, projects, 'UTC')).toBe('19 Aug 2026 · 5:27 · 3.4 GB · in 60th birthday');
    expect(panelMetaLine(log, projects, 'UTC')).toBe('0:21 · 3.7 MB');
  });

  it('prints where the clip is, with cached bytes and the countdown', () => {
    const now = new Date('2026-10-28T10:00:00Z');
    const drive = { clipId: 'party', cachedBytes: 40_400_000, lastReadAt: '2026-10-28T09:59:21Z' };

    expect(availabilityLine({ availability: 'cached', drive, releaseAfterS: 180 }, now)).toBe('Partly on this Mac · 40.4 MB · frees in 2:21');
    expect(availabilityLine({ availability: 'kept', drive: { ...drive, cachedBytes: 3_400_000_000 }, releaseAfterS: 180 }, now)).toBe('Kept offline · 3.4 GB');
    expect(availabilityLine({ availability: 'cloud', drive: undefined, releaseAfterS: null }, now)).toBe('In the cloud');
  });

  it('joins the names of every project a clip is in', () => {
    expect(projectNames(clip('both', { project_ids: ['p_t', 'p_b'] }), projects)).toBe('60th birthday, Australia trip');
  });
});
