// Layout constants for the 1080-wide composition: safe areas that keep captions clear of the
// platform UI (profile row and buttons at the bottom of 4:5 reels), and caption sizing.
import type { ShortAspect } from './schema.ts';

/** Distance from the bottom edge to the caption block, px at 1080 wide. */
export const CAPTION_BOTTOM: Record<ShortAspect, number> = { '4:5': 300, '1:1': 170 };
/** Caption font size, px at 1080 wide. */
export const CAPTION_SIZE: Record<ShortAspect, number> = { '4:5': 66, '1:1': 58 };
/** Text on the accent highlight: the dark ink used on the accent in the app (contrast 8.9:1). */
export const ON_ACCENT = '#04252e';
/** Caption fill and its outline for any footage. */
export const CAPTION_FILL = '#ffffff';
export const CAPTION_OUTLINE = 'rgba(0, 0, 0, 0.85)';
