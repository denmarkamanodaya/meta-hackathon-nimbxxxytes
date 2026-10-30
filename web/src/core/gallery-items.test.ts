import { describe, expect, it } from 'vitest';
import documentsJson from '../test-support/fixtures/documents.json';
import listensJson from '../test-support/fixtures/listens.json';
import { parseDocumentList } from '../services/api/parse-documents';
import { parseListenList } from '../services/api/parse-listens';
import { parsePhotoList } from '../services/api/parse-photos';
import photosJson from '../test-support/fixtures/photos.json';
import type { ClipSummary, Project } from '../services/api/types';
import { DEFAULT_GALLERY_SORT, GALLERY_SORT_PRESET, galleryHeaderLine } from './gallery';
import {
  dayItemsLine,
  documentTileLine,
  driveItemRef,
  itemProjectIds,
  galleryItems,
  itemRef,
  itemRow,
  itemTileLine,
  itemsDeleteToast,
  kindCounts,
  otherCountParts,
  parseGalleryKind,
  projectItemRef,
  projectItems,
  projectTargets,
  recordingChips,
  recordingTileLine,
  tickedClipIds,
} from './gallery-items';

const clip = (clip_id: string, recorded_at: string | null, over: Partial<ClipSummary> = {}): ClipSummary => ({
  clip_id,
  title: clip_id,
  filename: `${clip_id}.mp4`,
  duration_s: 16,
  recorded_at,
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

const listens = parseListenList(listensJson) ?? [];
const documents = parseDocumentList(documentsJson) ?? [];
const mermaid = listens.find((each) => each.id === 'lis_mermaid');
const water = documents[0];
if (mermaid === undefined || water === undefined) throw new Error('fixtures changed');

const dog = clip('dog', '2026-10-27T09:00:00Z');
const old = clip('old', '2025-10-18T09:00:00Z', { duration_s: 600 });
const backdrop = (parsePhotoList(photosJson) ?? []).find((each) => each.id === 'ph_4210');
if (backdrop === undefined) throw new Error('photos.json changed');
const sources = { clips: [dog, old], photos: [backdrop], listens: [mermaid], documents: [water] };

describe('galleryItems', () => {
  it('mixes the kinds newest first', () => {
    const items = galleryItems(sources, 'all', false, DEFAULT_GALLERY_SORT);

    expect(items.map((item) => item.id)).toEqual(['listen:lis_mermaid', `doc:${water.id}`, 'dog', 'photo:ph_4210', 'old']);
  });

  it('keeps one kind to itself, and a video filter to the videos', () => {
    expect(galleryItems(sources, 'recordings', false, DEFAULT_GALLERY_SORT).map((item) => item.kind)).toEqual(['recording']);
    expect(galleryItems(sources, 'photos', false, DEFAULT_GALLERY_SORT).map((item) => item.kind)).toEqual(['photo']);
    expect(galleryItems(sources, 'documents', false, DEFAULT_GALLERY_SORT).map((item) => item.kind)).toEqual(['document']);
    expect(galleryItems(sources, 'videos', false, DEFAULT_GALLERY_SORT).map((item) => item.id)).toEqual(['dog', 'old']);
    expect(galleryItems(sources, 'all', true, DEFAULT_GALLERY_SORT).map((item) => item.id)).toEqual(['dog', 'old']);
  });

  it('sorts by length across kinds, a document (no length) last', () => {
    const items = galleryItems(sources, 'all', false, GALLERY_SORT_PRESET.longest);

    expect(items.map((item) => item.id)).toEqual(['old', 'listen:lis_mermaid', 'dog', 'photo:ph_4210', `doc:${water.id}`]);
  });

  it('puts the others after the videos, newest first, on a column the others lack (Size)', () => {
    const items = galleryItems({ ...sources, clips: [old, dog] }, 'all', false, { by: 'size', dir: 'desc' });

    expect(items.map((item) => item.id)).toEqual(['old', 'dog', 'listen:lis_mermaid', `doc:${water.id}`, 'photo:ph_4210']);
  });
});

describe('counts and words', () => {
  it('counts each kind and says them in the header', () => {
    const counts = kindCounts({ clips: [dog, old], photos: [backdrop], listens, documents });

    expect(counts).toEqual({ all: 3 + listens.length + documents.length, videos: 2, photos: 1, recordings: listens.length, documents: documents.length });
    expect(otherCountParts({ all: 9, videos: 1, photos: 6, recordings: 1, documents: 1 })).toEqual(['6 photos', '1 recording', '1 document']);
    expect(otherCountParts({ all: 1, videos: 1, photos: 0, recordings: 0, documents: 0 })).toEqual([]);
    expect(galleryHeaderLine([dog], null, ['9 recordings', '1 document'])).toBe('1 clip · 9 recordings · 1 document · 3.7 MB in the cloud');
  });

  it('writes a recording tile and a document tile as the mock does', () => {
    expect(recordingChips(mermaid)).toEqual(['日本語', '中文', '→ EN']);
    expect(recordingChips({ ...mermaid, languages: [] })).toEqual([]);
    expect(recordingTileLine(mermaid, 'UTC')).toBe('30 Oct 2026 · iListen');
    expect(documentTileLine({ created_at: '2026-10-29T08:00:00Z', page_count: 1 }, 'UTC')).toBe('29 Oct 2026 · iRead · 1 page');
  });

  it('reads Gallery ids back, ticks only clips for Make a short, and fills a list row', () => {
    expect(itemRef('listen:l1')).toEqual({ kind: 'recording', id: 'l1' });
    expect(itemRef('doc:d1')).toEqual({ kind: 'document', id: 'd1' });
    expect(itemRef('photo:p1')).toEqual({ kind: 'photo', id: 'p1' });
    expect(itemRow({ kind: 'photo', id: 'photo:ph_4210', photo: backdrop }, 'cloud', [], 'UTC')).toMatchObject({ type: 'Photo · 6000 × 4000', recorded: '19 Aug 2026', size: '9.4 MB' });
    expect(itemTileLine({ kind: 'photo', id: 'photo:ph_4210', photo: backdrop }, 'UTC')).toBe('19 Aug 2026 · Photo');
    expect(itemRef('dog')).toEqual({ kind: 'video', id: 'dog' });
    expect(tickedClipIds(['dog', 'listen:l1', 'doc:d1'])).toEqual(['dog']);
    expect(itemRow({ kind: 'recording', id: 'listen:lis_mermaid', listen: mermaid }, 'cloud', [], 'UTC')).toMatchObject({
      name: 'Mermaids under lonely moonlight',
      type: 'Recording · iListen',
      length: '1:30',
      size: '1.8 MB',
      where: 'In the cloud',
      project: '—',
    });
    expect(parseGalleryKind('recordings')).toBe('recordings');
    expect(parseGalleryKind('nope')).toBe('all');
  });

  it('counts a mixed day, and toasts a mixed delete', () => {
    const items = galleryItems(sources, 'all', false, DEFAULT_GALLERY_SORT);

    expect(dayItemsLine(items)).toBe('2 clips · 1 photo · 1 recording · 1 document');
    expect(itemsDeleteToast({ deleted: ['a', 'b'], failed: [], firstError: null })).toEqual({ tone: 'info', title: '2 items deleted' });
    expect(itemsDeleteToast({ deleted: ['a'], failed: ['b'], firstError: 'x' })).toEqual({ tone: 'error', title: 'Could not delete 1 of 2 items', error: 'x' });
  });
});

describe('segments of the other kinds', () => {
  const birthday = { project_id: 'prj_birthday', name: '60th birthday' } as Project;
  const trip = { project_id: 'prj_trip', name: 'Australia trip' } as Project;
  const photo = { kind: 'photo', id: 'photo:ph_4210', photo: backdrop } as const;
  const doc = { kind: 'document', id: 'doc:doc_water', doc: water } as const;

  it('fills Where, Segment and Size for a photo, a recording and a document', () => {
    expect(itemRow(photo, 'kept', [birthday, trip], 'UTC')).toMatchObject({ where: 'Kept offline', project: '60th birthday' });
    expect(itemRow(doc, 'cached', [birthday, trip], 'UTC')).toMatchObject({ where: 'Partly on this Mac', project: 'Australia trip', size: '412 KB' });
    expect(itemRow({ ...doc, doc: { ...water, size_bytes: 0, project_ids: [] } }, 'cloud', [birthday], 'UTC')).toMatchObject({ size: '—', project: '—' });
  });

  it('names an item as the project endpoints and the drive do', () => {
    expect(projectItemRef(photo)).toEqual({ kind: 'photo', id: 'ph_4210' });
    expect(projectItemRef({ kind: 'recording', id: 'listen:lis_mermaid', listen: mermaid })).toEqual({ kind: 'listen', id: 'lis_mermaid' });
    expect(driveItemRef(doc)).toBe('doc:doc_water');
    expect(driveItemRef({ kind: 'recording', id: 'listen:lis_mermaid', listen: mermaid })).toBe('listen:lis_mermaid');
    expect(projectTargets(['dog', 'listen:l1', 'doc:d1', 'photo:p1'])).toEqual({
      clipIds: ['dog'],
      items: [
        { kind: 'listen', id: 'l1' },
        { kind: 'document', id: 'd1' },
        { kind: 'photo', id: 'p1' },
      ],
    });
  });

  it('lists a segment: its clips, then the other kinds that name it', () => {
    const inside = projectItems('prj_birthday', { clips: [dog], photos: [backdrop], listens: [mermaid], documents: [water] });
    expect(inside.map((item) => item.id)).toEqual(['dog', 'photo:ph_4210']);
    expect(itemProjectIds(photo)).toEqual(['prj_birthday']);
  });
});
