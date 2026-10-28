// Props and title layout of the CoverStill composition: a cover picture with its short title laid
// over it. The wire shape is owned by the Rust still builder (api/crates/contracts); this Zod
// schema validates it, and both sides test against fixtures/cover_still.sample.json.
import { z } from 'zod';
import { ThemeSchema } from './schema.ts';

/** Everything the composition needs to draw one titled cover. */
export const CoverStillPropsSchema = z.object({
  /** Presigned URL of the cover picture. */
  image_url: z.string().min(1),
  /** Output size, px. */
  width: z.int().positive(),
  height: z.int().positive(),
  title: z.object({
    /** The short title, 1 to 32 characters. */
    text: z.string().min(1).max(32),
    position: z.enum(['top', 'bottom']),
  }),
  theme: ThemeSchema,
});

/** Props of CoverStill. */
export type CoverStillProps = z.infer<typeof CoverStillPropsSchema>;
/** Where the title sits. */
export type TitlePosition = CoverStillProps['title']['position'];

/** Title size cap: 13 % of the width, for short titles. */
const MAX_SIZE_SHARE = 0.13;
/** Side inset, share of the width, on each side. */
const SIDE_INSET_SHARE = 0.08;
/** Average width of an uppercase character at weight 800, in em. */
const CHAR_EM = 0.62;

/**
 * Title font size: 13 % of the width when the title fits, smaller for long titles so it fits on
 * about two lines between the side insets (and its longest word on one line).
 * @param text - The title.
 * @param width - Output width, px.
 * @returns Font size, whole px.
 */
export function titleFontSize(text: string, width: number): number {
  const trimmed = text.trim();
  const longestWord = Math.max(0, ...trimmed.split(/\s+/).map((word) => word.length));
  const perLine = Math.max(1, longestWord, Math.ceil(trimmed.length / 2));
  const fit = (width * (1 - 2 * SIDE_INSET_SHARE)) / (perLine * CHAR_EM);
  return Math.round(Math.min(width * MAX_SIZE_SHARE, fit));
}

/** Absolute position of the title block, px. */
export interface TitlePlacement {
  left: number;
  right: number;
  top?: number;
  bottom?: number;
}

/**
 * Title placement: 8 % side insets; 9 % from the top or 7 % from the bottom.
 * @param position - Top or bottom.
 * @param width - Output width, px.
 * @param height - Output height, px.
 * @returns The block's offsets.
 */
export function titlePlacement(position: TitlePosition, width: number, height: number): TitlePlacement {
  const side = Math.round(width * SIDE_INSET_SHARE);
  return position === 'top'
    ? { left: side, right: side, top: Math.round(height * 0.09) }
    : { left: side, right: side, bottom: Math.round(height * 0.07) };
}
