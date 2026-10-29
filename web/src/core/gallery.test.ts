import { describe, expect, it } from 'vitest';
import type { ClipSummary, Project } from '../services/api/types';
import {
  availabilityLine,
  clipTypeLabel,
  GALLERY_FILTERS,
  galleryFilters,
  GALLERY_SORT_PRESET,
  nextSort,
  panelMetaLine,
  sortPreset,
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
  near_copy_of: null,
  angles: 0,
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
    expect(ids(galleryClips(all, 'all', GALLERY_SORT_PRESET.newest, where))).toEqual(['dog', 'party', 'log']);
    expect(ids(galleryClips(all, 'on-mac', GALLERY_SORT_PRESET.newest, where))).toEqual(['dog', 'party']);
    expect(ids(galleryClips(all, 'kept', GALLERY_SORT_PRESET.newest, where))).toEqual(['dog']);
    expect(ids(galleryClips(all, 'speech', GALLERY_SORT_PRESET.newest, where))).toEqual(['party']);
    expect(ids(galleryClips(all, 'faces', GALLERY_SORT_PRESET.newest, where))).toEqual(['party']);
    expect(ids(galleryClips(all, 'no-project', GALLERY_SORT_PRESET.newest, where))).toEqual(['log']);
    expect(ids(galleryClips(all, 'copies', GALLERY_SORT_PRESET.newest, where))).toEqual([]);
  });

  it('lists duplicates, near-copies and backfilled copies under Copies', () => {
    const near = { clip_id: 'dog', title: 'Dog', score: 0.95 };
    const copies = [
      ...all,
      clip('dup', { status: 'duplicate', duplicate_of: 'dog' }),
      clip('near', { status: 'near_copy', near_copy_of: near }),
      clip('linked', { near_copy_of: near }),
    ];

    expect(ids(galleryClips(copies, 'copies', GALLERY_SORT_PRESET.name, where))).toEqual(['dup', 'linked', 'near']);
  });

  it('sorts newest or oldest with undated clips last, longest, and by name', () => {
    expect(ids(galleryClips(all, 'all', GALLERY_SORT_PRESET.oldest, where))).toEqual(['party', 'dog', 'log']);
    expect(ids(galleryClips(all, 'all', GALLERY_SORT_PRESET.longest, where))).toEqual(['party', 'log', 'dog']);
    expect(ids(galleryClips(all, 'all', GALLERY_SORT_PRESET.name, where))).toEqual(['party', 'dog', 'log']);
  });

  it('sorts by any list column both ways, unknown values last either way', () => {
    expect(ids(galleryClips(all, 'all', { by: 'size', dir: 'desc' }, where))).toEqual(['party', 'dog', 'log']);
    expect(ids(galleryClips(all, 'all', { by: 'size', dir: 'asc' }, where))).toEqual(['dog', 'log', 'party']);
    expect(ids(galleryClips(all, 'all', { by: 'faces', dir: 'desc' }, where))).toEqual(['party', 'dog', 'log']);
    expect(ids(galleryClips(all, 'all', { by: 'where', dir: 'asc' }, where))).toEqual(['log', 'party', 'dog']);
    expect(ids(galleryClips(all, 'all', { by: 'name', dir: 'desc' }, where))).toEqual(['log', 'dog', 'party']);
    expect(ids(galleryClips(all, 'all', { by: 'recorded', dir: 'asc' }, where))).toEqual(['party', 'dog', 'log']);
    expect(ids(galleryClips(all, 'all', { by: 'project', dir: 'asc' }, where, projects))).toEqual(['party', 'dog', 'log']);
    expect(ids(galleryClips(all, 'all', { by: 'project', dir: 'desc' }, where, projects))).toEqual(['dog', 'party', 'log']);
  });

  it('sorts by type, kind first then format', () => {
    const photo = clip('photo', { filename: 'beach.JPG' });
    const mov = clip('mov', { filename: 'walk.mov' });
    expect(ids(galleryClips([mov, dog, photo], 'all', { by: 'type', dir: 'asc' }, where))).toEqual(['photo', 'mov', 'dog']);
  });

  it('flips the same column and starts a new one its own way', () => {
    expect(nextSort(GALLERY_SORT_PRESET.newest, 'recorded')).toEqual({ by: 'recorded', dir: 'asc' });
    expect(nextSort(GALLERY_SORT_PRESET.newest, 'name')).toEqual({ by: 'name', dir: 'asc' });
    expect(nextSort(GALLERY_SORT_PRESET.name, 'name')).toEqual({ by: 'name', dir: 'desc' });
    expect(nextSort(GALLERY_SORT_PRESET.name, 'size')).toEqual({ by: 'size', dir: 'desc' });
  });

  it('names a sort the menu has, and no other', () => {
    expect(sortPreset({ by: 'recorded', dir: 'desc' })).toBe('newest');
    expect(sortPreset({ by: 'length', dir: 'desc' })).toBe('longest');
    expect(sortPreset({ by: 'length', dir: 'asc' })).toBeNull();
  });

  it('shows every chip in the Mac app and leaves the drive chips out in a browser', () => {
    expect(galleryFilters(true)).toEqual(GALLERY_FILTERS);
    expect(galleryFilters(false)).toEqual(['all', 'speech', 'faces', 'no-project', 'copies']);
  });

  it('never reorders the list it was given', () => {
    galleryClips(all, 'all', GALLERY_SORT_PRESET.name, where);
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
  it('counts clips and their size in the header, copies left out but counted apart, with the cap when known', () => {
    const copy = clip('copy', { status: 'duplicate', size_bytes: 9_000_000_000 });
    const near = clip('near', { status: 'near_copy', near_copy_of: { clip_id: 'dog', title: 'Dog', score: 0.95 }, size_bytes: 9_000_000_000 });

    expect(galleryHeaderLine([dog, party], null)).toBe('2 clips · 3.4 GB in the cloud');
    expect(galleryHeaderLine([dog, party, copy], null)).toBe('2 clips · 1 duplicate · 3.4 GB in the cloud');
    expect(galleryHeaderLine([dog, party, copy, near], null)).toBe('2 clips · 1 near-copy · 1 duplicate · 3.4 GB in the cloud');
    expect(galleryHeaderLine([dog], 'of 250 GB')).toBe('1 clip · 3.7 MB of 250 GB in the cloud');
  });

  it('prints the tile line with the full date', () => {
    expect(tileLine(party, 'UTC')).toBe('19 Aug 2026 · 46 moments');
    expect(tileLine(clip('x', { recorded_at: null, segment_count: 1 }), 'UTC')).toBe('1 moment');
  });

  it('prints a file type as its kind and format', () => {
    expect(clipTypeLabel('walk.MOV')).toBe('Video · MOV');
    expect(clipTypeLabel('beach.jpeg')).toBe('Image · JPEG');
    expect(clipTypeLabel('letter.pdf')).toBe('Document · PDF');
    expect(clipTypeLabel('clip')).toBe('Video');
    expect(clipTypeLabel('.hidden')).toBe('Video');
    expect(clipTypeLabel('odd.')).toBe('Video');
  });

  it('fills a list row, with a dash for no moments, no faces and no project', () => {
    expect(galleryRow(party, 'cached', projects, 'UTC')).toEqual({
      name: '60th birthday celebration',
      type: 'Video · MP4',
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
