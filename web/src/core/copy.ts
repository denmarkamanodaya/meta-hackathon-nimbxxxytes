// User-facing words that the PWA and the Mac app share: storage, the three processing steps and
// the Studio statuses. One home per string, so both apps name the same thing the same way.

/** Where footage lives. Media sits in one cloud storage class, so none of these name a class. */
export const STORAGE_COPY = {
  inYourCloud: 'In your cloud',
  onThisPhone: 'On this phone',
  onThisMac: 'On this Mac',
  /** The PWA's storage line, under the two totals. */
  phoneLine: 'Plays from the cloud. Nothing is stored here.',
} as const;

/** The three places a clip can be on the Mac: one word each, on tiles, the legend and the meter. */
export const AVAILABILITY_COPY = {
  cloud: 'In the cloud',
  cached: 'On this Mac for a few minutes',
  kept: 'Kept offline',
} as const;

/**
 * The Mac drive sentence, split around the folder so the page can set the path apart.
 * @param folder - The drive as the user reads it (`~/nimbytes`).
 * @returns The text before the folder, the folder, and the text after it.
 */
export function macDriveLine(folder: string): { before: string; folder: string; after: string } {
  return {
    before: 'Your whole library is in Finder at ',
    folder,
    after: '. Files show their full size but stay in the cloud until you play them.',
  };
}

/** The three processing steps every clip goes through, in order. */
export const PROCESSING_STEPS = ['Uploading', 'Understanding', 'Ready'] as const;

/** A processing step's label. */
export type ProcessingStepLabel = (typeof PROCESSING_STEPS)[number];

/** Words for clips that leave the three steps. */
export const PROCESSING_COPY = {
  failed: 'Could not process',
  duplicate: 'Duplicate',
} as const;

/**
 * "Step 2 of 3".
 * @param step - 1-based step.
 * @returns The line.
 */
export const stepOfLine = (step: number): string => `Step ${String(step)} of ${String(PROCESSING_STEPS.length)}`;

/** Studio: where shorts are made and kept. */
export const STUDIO_COPY = {
  /** The tab, the PWA page title and the Mac sidebar group. */
  name: 'Studio',
  /** The Mac page title, under the Studio group. */
  shorts: 'Shorts',
  macSubtitle: 'Every cut the editor made, newest first.',
  newShort: 'New short',
  ready: 'Ready',
  resume: 'Resume',
  /** A short that stopped before any draft existed: nothing to resume. */
  stoppedBeforeDraft: 'Stopped before a draft',
} as const;

/**
 * "Paused at draft 1": a short whose editor stopped after `draft` drafts.
 * @param draft - Drafts made.
 * @returns The status words.
 */
export const pausedAtDraft = (draft: number): string => `Paused at draft ${String(draft)}`;

/**
 * "Editor score 44/50".
 * @param score - The best draft's score.
 * @param max - The highest possible score.
 * @returns The label.
 */
export const editorScoreLabel = (score: number, max: number): string => `Editor score ${String(score)}/${String(max)}`;
