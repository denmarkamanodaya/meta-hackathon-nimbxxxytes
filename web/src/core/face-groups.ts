// "Who's this?" cards: faces the server grouped as the same person or pet share one card;
// an ungrouped face is its own card. A card shows its best suggestion unless the owner said
// "Not them" to it this session.
import { formatDuration } from './format';
import type { FaceSuggestion, UnnamedFace } from '../services/api/types';

/** One card on the People screen. */
export interface FaceCard {
  /** The group id, or the track id of an ungrouped face. */
  key: string;
  faces: UnnamedFace[];
  /** Distinct clips the faces appear in. */
  clipCount: number;
  /** The most similar suggestion among the faces, unless dismissed. */
  suggested: FaceSuggestion | null;
}

const bestOf = (faces: readonly UnnamedFace[]): FaceSuggestion | null =>
  faces.reduce<FaceSuggestion | null>((best, face) => {
    const s = face.suggested;
    return s !== null && (best === null || s.similarity > best.similarity) ? s : best;
  }, null);

/**
 * Builds the cards in the order their first face arrives.
 * @param faces - Unnamed faces from the overview.
 * @param dismissed - Card keys whose suggestion the owner rejected.
 * @returns The cards.
 */
export function faceCards(faces: readonly UnnamedFace[], dismissed: ReadonlySet<string>): FaceCard[] {
  const byKey = new Map<string, UnnamedFace[]>();
  for (const face of faces) {
    const key = face.group_id ?? face.track_id;
    const list = byKey.get(key);
    if (list === undefined) byKey.set(key, [face]);
    else list.push(face);
  }
  return [...byKey.entries()].map(([key, group]) => ({
    key,
    faces: group,
    clipCount: new Set(group.map((f) => f.clip_id)).size,
    suggested: dismissed.has(key) ? null : bestOf(group),
  }));
}

/**
 * The context line under a face card: the clip and how long the face is on screen ("Coffee pour ·
 * 0:09"), or how many clips a group spans.
 * @param card - The card.
 * @returns The line.
 */
export function faceCardLine(card: FaceCard): string {
  if (card.clipCount > 1) return `in ${String(card.clipCount)} clips`;
  const [face] = card.faces;
  if (face === undefined) return '';
  const onScreen = card.faces.reduce((sum, f) => sum + f.on_screen_s, 0);
  return `${face.clip_title} · ${formatDuration(onScreen)}`;
}

/**
 * The line under "Is this Sam?": who confirmed the match and how far it reaches.
 * @param card - A card with a suggestion.
 * @returns For example "Muse Spark: same person, 3 clips".
 */
export function matchLine(card: FaceCard): string {
  return `Muse Spark: same person, ${String(card.clipCount)} ${card.clipCount === 1 ? 'clip' : 'clips'}`;
}
