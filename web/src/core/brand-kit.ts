// Brand kit rules the server also checks: 1 to 3 `#rrggbb` colours in lower case, each once, the
// first being the video accent; a PNG or JPG logo and up to 4 style references, each up to 5 MB.
// Also the kit in words, as New production's Style row shows it.
import type { BrandKit } from '../services/api/types';

const FONT_NAME = { bricolage: 'Bricolage, bold', geist: 'Geist, clean' } as const;

/**
 * A saved kit in words: "Bricolage, bold titles · logo".
 * @param kit - The saved kit.
 * @returns The summary.
 */
export const brandKitSummary = (kit: Pick<BrandKit, 'title_font' | 'logo_key'>): string =>
  `${FONT_NAME[kit.title_font]} titles${kit.logo_key === null ? '' : ' · logo'}`;

/** At most this many style references. */
export const MAX_BRAND_REFS = 4;

/** Largest logo or reference, bytes. */
export const MAX_BRAND_IMAGE_BYTES = 5 * 1024 * 1024;

/** Image types the kit accepts. */
export type BrandImageType = 'image/png' | 'image/jpeg';

/** Why an image cannot be used, or the type to upload it as. */
export type BrandImageCheck = { ok: true; type: BrandImageType } | { ok: false; reason: string };

/**
 * Checks a picked image before asking for an upload URL.
 * @param file - The picked file's type and size.
 * @returns The upload type, or the reason it is refused.
 */
export function checkBrandImage(file: { type: string; size: number }): BrandImageCheck {
  if (file.type !== 'image/png' && file.type !== 'image/jpeg') return { ok: false, reason: 'Use a PNG or JPG image.' };
  if (file.size > MAX_BRAND_IMAGE_BYTES) return { ok: false, reason: 'Use an image up to 5 MB.' };
  return { ok: true, type: file.type };
}

/**
 * The first reference slot (0–3) no saved key uses, so a new upload never overwrites a kept one.
 * @param keys - The kit's reference keys (`…/brand/ref_2.png`).
 * @returns The slot, or null when all 4 are taken.
 */
export function freeRefSlot(keys: readonly string[]): number | null {
  for (let slot = 0; slot < MAX_BRAND_REFS; slot += 1) {
    if (!keys.some((key) => key.includes(`/ref_${String(slot)}.`))) return slot;
  }
  return null;
}

/** At most this many colours. */
export const MAX_BRAND_COLORS = 3;

const HEX = /^#[0-9a-f]{6}$/;

/**
 * A colour as the kit stores it: trimmed, lower case, with its `#`.
 * @param raw - A colour as typed or picked.
 * @returns The colour, or null when it is not a 6-digit hex colour.
 */
export function normalizeColor(raw: string): string | null {
  const trimmed = raw.trim().toLowerCase();
  const color = trimmed.startsWith('#') ? trimmed : `#${trimmed}`;
  return HEX.test(color) ? color : null;
}

/**
 * Adds a colour at the end, unless the list is full, the colour is invalid or already listed.
 * @param colors - The current list.
 * @param raw - The new colour.
 * @returns A new list (the same values when nothing was added).
 */
export function addColor(colors: readonly string[], raw: string): string[] {
  const color = normalizeColor(raw);
  if (color === null || colors.length >= MAX_BRAND_COLORS || colors.includes(color)) return [...colors];
  return [...colors, color];
}

/**
 * Replaces the colour at `index`; an invalid colour or one listed elsewhere changes nothing.
 * @param colors - The current list.
 * @param index - The swatch to change.
 * @param raw - The new colour.
 * @returns A new list.
 */
export function replaceColor(colors: readonly string[], index: number, raw: string): string[] {
  const color = normalizeColor(raw);
  if (color === null || index < 0 || index >= colors.length) return [...colors];
  if (colors.some((c, i) => c === color && i !== index)) return [...colors];
  return colors.map((c, i) => (i === index ? color : c));
}

/**
 * Whether a swatch may be removed: a kit keeps at least one colour.
 * @param colors - The current list.
 * @returns True with two or more colours.
 */
export const canRemoveColor = (colors: readonly string[]): boolean => colors.length > 1;

/**
 * Removes the colour at `index`, unless it is the last one; the next colour then becomes the
 * accent.
 * @param colors - The current list.
 * @param index - The swatch to remove.
 * @returns A new list.
 */
export function removeColor(colors: readonly string[], index: number): string[] {
  if (!canRemoveColor(colors)) return [...colors];
  return colors.filter((_, i) => i !== index);
}

/**
 * Whether the list can be saved.
 * @param colors - The current list.
 * @returns True for 1 to 3 valid, distinct colours.
 */
export const isSavableColorList = (colors: readonly string[]): boolean =>
  colors.length >= 1 &&
  colors.length <= MAX_BRAND_COLORS &&
  colors.every((c) => normalizeColor(c) === c) &&
  new Set(colors).size === colors.length;

/**
 * The colour a swatch of the three-slot editor (Settings › Brand) shows: the kit's colour there,
 * else the starter colour for that slot.
 * @param colors - The kit's colours.
 * @param starters - Starter colours, one per slot.
 * @param index - The slot, 0–2.
 * @returns The colour, or '' when neither has one.
 */
export function colorInSlot(colors: readonly string[], starters: readonly string[], index: number): string {
  return colors[index] ?? starters[index] ?? '';
}

/**
 * Sets one slot of the three-slot editor. A slot past the kit's colours fills the slots before it
 * with their starters, so the list never has a hole; an invalid colour, or one another slot
 * already uses, changes nothing.
 * @param colors - The kit's colours.
 * @param starters - Starter colours, one per slot.
 * @param index - The slot, 0–2.
 * @param raw - The picked colour.
 * @returns The new list.
 */
export function setColorSlot(colors: readonly string[], starters: readonly string[], index: number, raw: string): string[] {
  const color = normalizeColor(raw);
  if (color === null || index < 0 || index >= MAX_BRAND_COLORS) return [...colors];
  const length = Math.max(colors.length, index + 1);
  const next = Array.from({ length }, (_, i) => (i === index ? color : normalizeColor(colorInSlot(colors, starters, i))));
  const list = next.filter((c): c is string => c !== null);
  return list.length === length && isSavableColorList(list) ? list : [...colors];
}
