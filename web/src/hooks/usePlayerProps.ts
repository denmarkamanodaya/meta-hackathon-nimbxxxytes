// Player input for a version: its composition props validated with the renderer's own schema,
// then laid out by the editor's draft so reorder / drop / trim show before anything is saved.
import { useMemo } from 'react';
import { deriveProps, ShortPropsSchema, type DraftClip, type ShortProps } from '@nimbytes/composition';

/**
 * Validates raw props (lenient: a contract drift must not hide the trail; the panel then falls
 * back to the preview MP4. Both sides test against render/fixtures/props.sample.json).
 * @param raw - `version.composition_props`.
 * @returns The props, or null when missing or not matching the schema.
 */
export function readPlayerProps(raw: unknown): ShortProps | null {
  const parsed = ShortPropsSchema.safeParse(raw);
  return parsed.success ? parsed.data : null;
}

/**
 * Player props for a version and its current draft.
 * @param raw - The version's `composition_props`.
 * @param draft - Clips as the editor holds them.
 * @returns Props for the Player, or null to fall back to the preview video.
 */
export function usePlayerProps(raw: unknown, draft: readonly DraftClip[]): ShortProps | null {
  const base = useMemo(() => readPlayerProps(raw), [raw]);
  return useMemo(() => (base === null ? null : deriveProps(base, draft)), [base, draft]);
}
