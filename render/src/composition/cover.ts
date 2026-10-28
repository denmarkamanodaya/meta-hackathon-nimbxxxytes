// Props and title layout of the CoverStill composition: a cover picture with its short title laid
// over it, optionally blurred and with a cut-out subject in front. The wire shape is owned by the Rust still builder (api/crates/contracts); this Zod
// schema validates it, and both sides test against fixtures/cover_still.sample.json.
import { z } from 'zod';
import { CutoutSourceSchema } from './cutout.ts';
import { FONT_FILES } from './fonts.ts';
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
  /** Blur the cover picture into a soft background (the "Blurred frame" cutout cover). */
  background_blur: z.boolean().optional(),
  /** A cut-out subject drawn above the title, standing bottom-centre. */
  cutout: CutoutSourceSchema.optional(),
});

/** Props of CoverStill. */
export type CoverStillProps = z.infer<typeof CoverStillPropsSchema>;
/** Where the title sits. */
export type TitlePosition = CoverStillProps['title']['position'];

/** Background blur radius at 1080 wide, px. */
const BACKGROUND_BLUR_PX = 24;

/**
 * Background blur radius for a cover, scaled with its width.
 * @param width - Output width, px.
 * @returns Blur radius, whole px.
 */
export function backgroundBlurPx(width: number): number {
  return Math.round((BACKGROUND_BLUR_PX * width) / 1080);
}

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

/** Weight for a family that is not bundled: the browser's fallback face draws it. */
const FALLBACK_WEIGHT = 600;

/**
 * Title weight: the heaviest weight bundled for the stack's first family, so the title never asks
 * for a weight the browser would silently swap for a lighter one.
 * @param font - CSS font-family stack, for example `'Bricolage Grotesque', sans-serif`.
 * @returns A CSS font weight.
 */
export function titleWeight(font: string): number {
  const family = (font.split(',')[0] ?? '').trim().replace(/^['"]|['"]$/g, '');
  const weights = FONT_FILES.filter((f) => f.family === family).flatMap((f) => f.weight.split(/\s+/).map(Number));
  return weights.length === 0 ? FALLBACK_WEIGHT : Math.max(...weights);
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
