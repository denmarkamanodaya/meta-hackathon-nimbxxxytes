// The promo's typefaces: Outfit (thin, clean) for headlines, the lockup and names; Inter for
// labels and UI text. No heavy weights: the look is light and calm.
import { loadFont as loadCaveat } from '@remotion/google-fonts/Caveat';
import { loadFont as loadInter } from '@remotion/google-fonts/Inter';
import { loadFont as loadOutfit } from '@remotion/google-fonts/Outfit';
import { loadFont as loadRoboto } from '@remotion/google-fonts/Roboto';

export const DISPLAY = loadOutfit('normal', { weights: ['200', '300', '400'], subsets: ['latin'] }).fontFamily;
export const INTER = loadInter('normal', { weights: ['300', '400', '500'], subsets: ['latin'] }).fontFamily;
/** Kept for older scenes that still import it; it is the same light display face. */
export const ARCHIVO = DISPLAY;
/** The demo's face: Roboto, light weights only, on a white page. */
export const ROBOTO = loadRoboto('normal', { weights: ['300', '400', '500'], subsets: ['latin'] }).fontFamily;
/** Handwriting, for captions written on printed photos. */
export const HANDWRITING = loadCaveat('normal', { weights: ['400'], subsets: ['latin'] }).fontFamily;
