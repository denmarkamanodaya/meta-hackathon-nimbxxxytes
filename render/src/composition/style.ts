// Layout constants for the 1080-wide composition: safe areas that keep captions clear of the
// platform UI (profile row and buttons at the bottom of 4:5 reels), and caption sizing.
import type { ShortAspect } from './schema.ts';

/** Distance from the bottom edge to the caption block, px at 1080 wide. */
export const CAPTION_BOTTOM: Record<ShortAspect, number> = { '4:5': 300, '1:1': 170 };
/** Caption font size, px at 1080 wide. */
export const CAPTION_SIZE: Record<ShortAspect, number> = { '4:5': 66, '1:1': 58 };
/** Caption fill and its outline for any footage. */
export const CAPTION_FILL = '#ffffff';
export const CAPTION_OUTLINE = 'rgba(0, 0, 0, 0.85)';
/** Soft shadow under every word, so white and accent words both read on bright footage. */
export const CAPTION_SHADOW = '0 4px 18px rgba(0, 0, 0, 0.55)';

/** Colour and outline of one caption word. */
export interface CaptionWordPaint {
  color: string;
  stroke: string;
}

/**
 * Paint for a caption word: white with a dark outline, and the word being said in the accent
 * colour (same outline, no background pill).
 * @param isActive - Whether this is the word being said.
 * @param accent - The short's accent colour.
 * @returns Its colour and text stroke.
 */
export const captionWordPaint = (isActive: boolean, accent: string): CaptionWordPaint => ({
  color: isActive ? accent : CAPTION_FILL,
  stroke: `3px ${CAPTION_OUTLINE}`,
});
