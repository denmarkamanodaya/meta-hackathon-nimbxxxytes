// Mock photos for `npm run dev:mock` and `dev:desktop-mock`: six photos of the 60th birthday
// (photos.json; small JPEG data URLs from photo-images.json stand in for the thumbnail and the
// viewing copy). A new photo walks uploading → analysing → ready on the clock and comes out as one
// of the six pictures. Search mixes photos in for a query with "60" (the flower backdrop and wall)
// or "red" (the stage-light photos). The same rules the API enforces: the five photo types, 40 MB,
// a title of 1–80 characters.
import { PHOTO_MAX_BYTES, PHOTO_TYPES, MAX_PHOTO_TITLE_CHARS } from '../../core/photos';
import { parsePhoto } from '../../services/api/parse-photos';
import type { PhotoDetail, PhotoSummary, SearchResult } from '../../services/api/types';
import photoImages from '../fixtures/photo-images.json';
import photosJson from '../fixtures/photos.json';
import { createItemMemberships, type ItemMemberships } from './memberships';
import { fail, json, type MockRoute } from './reply';

/** How long the mock looks at a new photo, ms. */
export const ANALYSE_MS = 3000;

/** The picture of each fixture by its file name's stem. */
const IMAGES: Partial<Record<string, string>> = photoImages;
const PICTURES = Object.values(photoImages);

const stem = (filename: string): string => filename.replace(/\.[^.]+$/, '');

/** The fixture with the data URL in place of storage links. */
const served = (photo: PhotoDetail, picture: string | null): PhotoDetail => ({
  ...photo,
  thumb_url: photo.thumb_url === null ? null : picture,
  image_url: photo.image_url === null ? null : picture,
  original_url: photo.original_url === null ? null : picture,
});

function samples(): PhotoDetail[] {
  return photosJson.map((raw) => {
    const photo = parsePhoto(raw);
    if (photo === null) throw new Error(`mock fixture photos.json ${raw.id} does not parse`);
    return served(photo, IMAGES[stem(photo.filename)] ?? null);
  });
}

const summaryOf = (photo: PhotoDetail): PhotoSummary => {
  const { id, title, filename, status, taken_at, width, height, size_bytes, thumb_url, created_at, project_ids, error } = photo;
  return { id, title, filename, status, taken_at, width, height, size_bytes, thumb_url, created_at, project_ids, error };
};

/** Which photos a query finds, best first. */
const PHOTO_QUERIES: readonly { match: RegExp; ids: readonly string[] }[] = [
  { match: /60|flower|backdrop/i, ids: ['ph_4210', 'ph_4228'] },
  { match: /red|stage|light/i, ids: ['ph_4949', 'ph_4946', 'ph_4942'] },
];

/**
 * Builds the photo routes.
 * @param now - Clock in ms.
 * @param memberships - Segment membership shared with the Projects mock.
 * @returns The routes, and the photo hits for a search query.
 */
export function createPhotosMock(now: () => number, memberships: ItemMemberships = createItemMemberships()): { routes: MockRoute[]; searchHits: (query: string) => SearchResult[] } {
  let photos: { photo: PhotoDetail; analysedFrom: number | null }[] = samples().map((photo) => ({ photo, analysedFrom: null }));
  let nextId = 1;
  memberships.register('photo', () => photos.map((entry) => entry.photo.id), photos.map((entry) => entry.photo));

  const advance = (entry: (typeof photos)[number]): PhotoDetail => {
    if (entry.analysedFrom === null || now() - entry.analysedFrom < ANALYSE_MS) return entry.photo;
    entry.analysedFrom = null;
    const picture = PICTURES[(nextId - 1) % PICTURES.length] ?? null;
    entry.photo = {
      ...entry.photo,
      status: 'ready',
      title: 'A new photo of the party',
      description: 'Guests gather in the decorated hall; balloons and flowers line the stage.',
      things: ['guests', 'balloons', 'flowers', 'stage'],
      width: 6000,
      height: 4000,
      thumb_url: picture,
      image_url: picture,
      original_url: picture,
      camera: 'Canon EOS 80D',
    };
    return entry.photo;
  };
  const view = (entry: (typeof photos)[number]): PhotoDetail => ({ ...advance(entry), project_ids: memberships.of('photo', entry.photo.id) });
  const find = (id: string) => photos.find((entry) => entry.photo.id === decodeURIComponent(id));

  const searchHits = (query: string): SearchResult[] => {
    const ids = PHOTO_QUERIES.filter((rule) => rule.match.test(query)).flatMap((rule) => rule.ids);
    return ids.flatMap((id, rank) => {
      const entry = find(id);
      if (entry === undefined) return [];
      const photo = view(entry);
      return [
        {
          kind: 'photo' as const,
          photo_id: photo.id,
          segment_id: `photo:${photo.id}`,
          clip_id: '',
          start_s: 0,
          end_s: 0,
          thumb_url: photo.thumb_url,
          reason: photo.description,
          score: 0.95 - rank * 0.03,
          clip_filename: photo.filename,
          clip_title: photo.title,
          recorded_at: photo.taken_at,
          faces: [],
        },
      ];
    });
  };

  const routes: MockRoute[] = [
    ['GET', /^\/photos$/, () => json(photos.map((entry) => summaryOf(view(entry))), 250)],
    ['POST', /^\/photos$/, (_m, req) => {
      const body = (req.body ?? {}) as { filename?: unknown; content_type?: unknown; size_bytes?: unknown; last_modified?: unknown };
      if (!PHOTO_TYPES.some((type) => type === body.content_type)) return fail(400, 'VALIDATION_FAILED', 'content_type must be a JPEG, PNG, WebP or HEIC photo');
      if (typeof body.size_bytes !== 'number' || body.size_bytes <= 0 || body.size_bytes > PHOTO_MAX_BYTES) {
        return fail(400, 'VALIDATION_FAILED', 'size_bytes must be 1 byte to 40 MB');
      }
      const id = `ph_new_${String(nextId)}`;
      nextId += 1;
      const filename = typeof body.filename === 'string' ? body.filename : 'photo.jpg';
      const photo: PhotoDetail = {
        id,
        title: filename,
        filename,
        status: 'uploading',
        taken_at: typeof body.last_modified === 'string' ? body.last_modified : null,
        width: null,
        height: null,
        size_bytes: body.size_bytes,
        thumb_url: null,
        project_ids: [],
        created_at: new Date(now()).toISOString(),
        error: null,
        description: '',
        things: [],
        image_url: null,
        original_url: null,
        camera: null,
      };
      photos = [{ photo, analysedFrom: null }, ...photos];
      return json({ photo_id: id, status: 'uploading' }, 200, 201);
    }],
    // The file itself (the mock is not sent its bytes): it queues the analysis, as the API does.
    ['PUT', /^\/photos\/([^/]+)\/source$/, (m) => {
      const entry = find(m[1] ?? '');
      if (entry === undefined) return fail(404, 'NOT_FOUND', 'No such photo');
      if (entry.photo.status === 'uploading') {
        entry.photo = { ...entry.photo, status: 'analysing' };
        entry.analysedFrom = now();
      }
      return json({ photo_id: entry.photo.id, status: view(entry).status }, 400, 202);
    }],
    ['GET', /^\/photos\/([^/]+)$/, (m) => {
      const entry = find(m[1] ?? '');
      return entry === undefined ? fail(404, 'NOT_FOUND', 'No such photo') : json(view(entry), 250);
    }],
    ['PATCH', /^\/photos\/([^/]+)$/, (m, req) => {
      const entry = find(m[1] ?? '');
      if (entry === undefined) return fail(404, 'NOT_FOUND', 'No such photo');
      const raw = ((req.body ?? {}) as { title?: unknown }).title;
      const title = typeof raw === 'string' ? raw.trim() : '';
      if (title === '' || Array.from(title).length > MAX_PHOTO_TITLE_CHARS) {
        return fail(400, 'VALIDATION_FAILED', `title must be 1–${String(MAX_PHOTO_TITLE_CHARS)} characters`);
      }
      entry.photo = { ...view(entry), title };
      return json(entry.photo, 200);
    }],
    ['DELETE', /^\/photos\/([^/]+)$/, (m) => {
      const entry = find(m[1] ?? '');
      if (entry === undefined) return fail(404, 'NOT_FOUND', 'No such photo');
      photos = photos.filter((each) => each !== entry);
      return { kind: 'empty', status: 204 };
    }],
  ];
  return { routes, searchHits };
}
