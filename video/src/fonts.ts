// The promo's typefaces: Outfit (thin, clean) for headlines, the lockup and names; Inter for
// labels and UI text. No heavy weights: the look is light and calm.
import { loadFont as loadInter } from '@remotion/google-fonts/Inter';
import { loadFont as loadOutfit } from '@remotion/google-fonts/Outfit';

export const DISPLAY = loadOutfit('normal', { weights: ['200', '300', '400'], subsets: ['latin'] }).fontFamily;
export const INTER = loadInter('normal', { weights: ['300', '400', '500'], subsets: ['latin'] }).fontFamily;
/** Kept for older scenes that still import it; it is the same light display face. */
export const ARCHIVO = DISPLAY;
