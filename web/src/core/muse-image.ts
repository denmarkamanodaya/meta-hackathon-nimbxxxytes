// What a Muse Image drawing costs and how long it takes, as the cost lines under each button say
// it: "$0.03 · about 15 s" under Make 3 more, "$0.01 · about 15 s" under Redraw, "New art · $0.01".
import { MUSE_IMAGE_COPY } from './copy';

/** Price of one drawn image, USD. */
export const IMAGE_PRICE_USD = 0.01;

/** About how long a drawing takes, seconds (several images are drawn at once). */
export const IMAGE_SECONDS = 15;

/** Images "Make 3 more" draws. */
export const MORE_COVERS_COUNT = 3;

/**
 * A price in whole cents: "$0.03".
 * @param usd - Amount, USD.
 * @returns The price.
 */
export const formatPrice = (usd: number): string => `$${(Math.round(usd * 100) / 100).toFixed(2)}`;

/**
 * The price of some images: "$0.03" for three.
 * @param images - How many are drawn.
 * @returns The price.
 */
export const imagesPrice = (images: number): string => formatPrice(images * IMAGE_PRICE_USD);

/**
 * A cost line: "$0.03 · about 15 s".
 * @param images - How many images the action draws.
 * @returns The line.
 */
export const costLine = (images: number): string => `${imagesPrice(images)} · about ${String(IMAGE_SECONDS)} s`;

/** The cost lines and priced labels of boards V14–V17. */
export const MUSE_COST = {
  /** Under "Make 3 more · <style>". */
  moreCovers: costLine(MORE_COVERS_COUNT),
  /** Under Redraw (with words). */
  redrawCover: costLine(1),
  /** Under Redraw from footage. */
  footageBoard: `${costLine(1)} · ${MUSE_IMAGE_COPY.hookFrameNote}`,
  /** The New art button. */
  newArt: `${MUSE_IMAGE_COPY.newArt} · ${imagesPrice(1)}`,
} as const;
