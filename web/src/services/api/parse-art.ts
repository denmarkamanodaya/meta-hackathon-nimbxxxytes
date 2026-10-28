// Parsers for the key art fields productions and projects carry (`art_url`, `art_drawing`) and the
// moments a project's art was drawn from. Absent fields read as "no art yet", so an answer from
// before key art existed still parses; a present field of the wrong type rejects the body.
import { isBoolean, isNullable, isNumber, isRecord, isString, parseEvery, type Json } from './json-guards';
import type { ArtSource } from './types';

/** The key art of a production or project. */
export interface ArtFields {
  art_url: string | null;
  art_drawing: boolean;
}

/**
 * Reads `art_url` and `art_drawing` from a production or project body.
 * @param value - The body's record.
 * @returns The fields, or null when one is present with the wrong type.
 */
export function parseArtFields(value: Json): ArtFields | null {
  const art_url = value.art_url === undefined ? null : value.art_url;
  const art_drawing = value.art_drawing === undefined ? false : value.art_drawing;
  if (!isNullable(art_url, isString) || !isBoolean(art_drawing)) return null;
  return { art_url, art_drawing };
}

function parseArtSource(value: unknown): ArtSource | null {
  if (!isRecord(value) || !isString(value.clip_id) || !isString(value.clip_title) || !isString(value.title)) return null;
  if (!isNumber(value.start_s) || !isNullable(value.thumb_url, isString)) return null;
  return { clip_id: value.clip_id, clip_title: value.clip_title, title: value.title, start_s: value.start_s, thumb_url: value.thumb_url };
}

/**
 * Reads a project's `art_sources`.
 * @param value - The field (absent reads as none).
 * @returns The moments, or null when malformed.
 */
export const parseArtSources = (value: unknown): ArtSource[] | null =>
  value === undefined ? [] : parseEvery(value, parseArtSource);
