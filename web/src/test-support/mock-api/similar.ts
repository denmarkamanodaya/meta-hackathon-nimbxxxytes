// Mock near-copies and same moments (Phase 29, boards V52–V54): the sample clips (a trimmed export
// of Beach walk, the pier filmed on glasses and phone 40 s apart, a duplicate of Night market and a
// 480p copy of Long-tail boat), each clip's `links`, the `angles` count worked out from the clips
// still there, and Keep both: the near-copy is processed for a moment, then ready, with its link
// gone. Pure request → reply over the router's clip list.
import { parseClipList } from '../../services/api/parse';
import type { ClipLink, ClipSummary } from '../../services/api/types';
import similarClipsJson from '../fixtures/similar-clips.json';
import type { ClipAccess } from './projects';
import { fail, json, type MockRoute } from './reply';
import { sceneThumb } from './thumbs';

/** How long a kept clip stays processing, ms. */
export const KEEP_PROCESSING_MS = 4000;

/** Same-moment pairs and how alike they are. */
const SAME_MOMENT: readonly [string, string, number][] = [['clip_pier_glasses', 'clip_pier_phone', 0.89]];

/**
 * The picture a clip's thumbnail is drawn from: a copy shares its original's, so the two look alike.
 * @param clip - The clip.
 * @returns The id to draw.
 */
export const thumbKey = (clip: Pick<ClipSummary, 'clip_id' | 'duplicate_of' | 'near_copy_of'>): string =>
  clip.near_copy_of?.clip_id ?? clip.duplicate_of ?? clip.clip_id;

/** The sample clips. */
export function similarClips(): ClipSummary[] {
  const parsed = parseClipList(similarClipsJson);
  if (parsed === null) throw new Error('mock fixture similar-clips.json does not parse');
  return parsed;
}

/**
 * Builds the near-copy mock.
 * @param clips - The router's clip list.
 * @param now - Clock in ms.
 * @returns `decorate` (the list item as the API sends it now), `linksFor` and the Keep route.
 */
export function createSimilarMock(clips: ClipAccess, now: () => number) {
  /** Kept clips and when Keep both was pressed. */
  const kept = new Map<string, number>();

  const asLink = (other: ClipSummary, kind: ClipLink['kind'], score: number): ClipLink => ({
    clip_id: other.clip_id,
    title: other.title,
    kind,
    score,
    recorded_at: other.recorded_at,
    thumb_url: sceneThumb(thumbKey(other)),
    duration_s: other.duration_s,
  });

  const partners = (clipId: string): [string, number][] =>
    SAME_MOMENT.flatMap(([a, b, score]): [string, number][] => (a === clipId ? [[b, score]] : b === clipId ? [[a, score]] : []));

  function decorate(clip: ClipSummary): ClipSummary {
    const ids = new Set(clips.get().map((c) => c.clip_id));
    const angles = partners(clip.clip_id).filter(([id]) => ids.has(id)).length;
    const keptAt = kept.get(clip.clip_id);
    const status = keptAt !== undefined && now() - keptAt >= KEEP_PROCESSING_MS && clip.status === 'processing' ? 'ready' : clip.status;
    return { ...clip, angles, status };
  }

  function linksFor(clipId: string): ClipLink[] {
    const all = clips.get();
    const clip = all.find((c) => c.clip_id === clipId);
    if (clip === undefined) return [];
    const byId = (id: string) => all.find((c) => c.clip_id === id);
    const original = clip.near_copy_of === null ? undefined : byId(clip.near_copy_of.clip_id);
    return [
      ...(original === undefined || clip.near_copy_of === null ? [] : [asLink(original, 'near_copy_of', clip.near_copy_of.score)]),
      ...all.filter((c) => c.near_copy_of?.clip_id === clipId).map((c) => asLink(c, 'copied_by', c.near_copy_of?.score ?? 0)),
      ...partners(clipId).flatMap(([id, score]) => {
        const other = byId(id);
        return other === undefined ? [] : [asLink(other, 'same_moment', score)];
      }),
    ];
  }

  const routes: MockRoute[] = [
    [
      'POST',
      /^\/clips\/([^/]+)\/keep$/,
      (m) => {
        const id = decodeURIComponent(m[1] ?? '');
        const clip = clips.get().find((c) => c.clip_id === id);
        if (clip === undefined) return fail(404, 'NOT_FOUND', 'No such clip');
        if (clip.status !== 'near_copy' && clip.near_copy_of === null) return fail(400, 'VALIDATION_FAILED', 'This clip is not a near-copy');
        const status = clip.status === 'near_copy' ? 'processing' : clip.status;
        if (status === 'processing') kept.set(id, now());
        clips.set(clips.get().map((c) => (c.clip_id === id ? { ...c, status, near_copy_of: null } : c)));
        return json({ clip_id: id, status }, 300, 202);
      },
    ],
  ];

  return { decorate, linksFor, routes };
}
