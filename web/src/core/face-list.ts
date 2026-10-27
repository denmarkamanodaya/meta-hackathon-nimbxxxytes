// The Mac Faces page (redesign v2, V5): every face as one square card (named people, faces waiting
// for a name, hidden faces), the All / Named / Not named / Hidden chips with their counts, the
// header line, and the "0:07 – 0:08" span under a face. Pure: the overview comes in as an argument.
import { formatDuration } from './format';
import type { FaceSuggestion, PeopleOverview } from '../services/api/types';

/** Which faces a chip shows. */
export type FaceFilter = 'all' | 'named' | 'unnamed' | 'hidden';

/** The chips, in order, with their words. */
export const FACE_FILTERS: readonly { value: FaceFilter; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'named', label: 'Named' },
  { value: 'unnamed', label: 'Not named' },
  { value: 'hidden', label: 'Hidden' },
];

/** One card. A named person has no track; a face (named or hidden) has no person. */
export interface FaceItem {
  key: string;
  kind: 'named' | 'unnamed' | 'hidden';
  /** The person's name; null for a face. */
  name: string | null;
  cropUrl: string | null;
  trackId: string | null;
  personId: string | null;
  clipId: string | null;
  clipTitle: string | null;
  /** Clips a named person is in; 1 for a face. */
  clipCount: number;
  /** Who face matching thinks this is (only while it is on). */
  suggested: FaceSuggestion | null;
}

/**
 * Every card: named people first, then the faces waiting for a name, then the hidden ones.
 * @param overview - `GET /api/people/overview`.
 * @returns The cards.
 */
export function faceItems(overview: PeopleOverview): FaceItem[] {
  const named = overview.people.map<FaceItem>((person) => ({
    key: `p:${person.person_id}`,
    kind: 'named',
    name: person.name,
    cropUrl: person.crop_url,
    trackId: null,
    personId: person.person_id,
    clipId: null,
    clipTitle: null,
    clipCount: person.clip_count,
    suggested: null,
  }));
  const unnamed = overview.unnamed.map<FaceItem>((face) => ({
    key: `t:${face.track_id}`,
    kind: 'unnamed',
    name: null,
    cropUrl: face.crop_url,
    trackId: face.track_id,
    personId: null,
    clipId: face.clip_id,
    clipTitle: face.clip_title,
    clipCount: 1,
    suggested: face.suggested,
  }));
  const hidden = overview.hidden.map<FaceItem>((face) => ({
    key: `t:${face.track_id}`,
    kind: 'hidden',
    name: null,
    cropUrl: face.crop_url,
    trackId: face.track_id,
    personId: null,
    clipId: face.clip_id,
    clipTitle: face.clip_title,
    clipCount: 1,
    suggested: null,
  }));
  return [...named, ...unnamed, ...hidden];
}

/**
 * The cards a chip shows. "All" leaves hidden faces out: hiding a face takes it off the page.
 * @param items - Every card.
 * @param filter - The chip.
 * @returns The cards, in order.
 */
export function filterFaces(items: readonly FaceItem[], filter: FaceFilter): FaceItem[] {
  if (filter === 'all') return items.filter((item) => item.kind !== 'hidden');
  return items.filter((item) => item.kind === filter);
}

/**
 * How many cards each chip shows.
 * @param items - Every card.
 * @returns The count per chip.
 */
export function faceCounts(items: readonly FaceItem[]): Record<FaceFilter, number> {
  return {
    all: filterFaces(items, 'all').length,
    named: filterFaces(items, 'named').length,
    unnamed: filterFaces(items, 'unnamed').length,
    hidden: filterFaces(items, 'hidden').length,
  };
}

/**
 * The header line: "35 faces in 1 clip · none named yet", "8 faces in 3 clips · 2 named".
 * @param items - Every card.
 * @returns The line.
 */
export function facesLine(items: readonly FaceItem[]): string {
  const counts = faceCounts(items);
  const clips = new Set(items.flatMap((item) => (item.clipId === null ? [] : [item.clipId]))).size;
  const faces = `${String(counts.all)} ${counts.all === 1 ? 'face' : 'faces'}`;
  const where = clips === 0 ? '' : ` in ${String(clips)} ${clips === 1 ? 'clip' : 'clips'}`;
  const named = counts.named === 0 ? 'none named yet' : `${String(counts.named)} named`;
  return `${faces}${where} · ${named}`;
}

/**
 * When a face is on screen: "0:07 – 0:08", or just "0:07" when it is seen for under a second.
 * @param firstS - First second it is seen.
 * @param lastS - Last second it is seen.
 * @returns The span.
 */
export function faceSpan(firstS: number, lastS: number): string {
  const from = formatDuration(firstS);
  const to = formatDuration(lastS);
  return from === to ? from : `${from} – ${to}`;
}
