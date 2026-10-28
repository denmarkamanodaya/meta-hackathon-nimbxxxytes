// User-facing words that the PWA and the Mac app share: section names, storage, the three
// processing steps and the Studio statuses. One home per string, so both apps name the same thing
// the same way.

/**
 * Section and tab names (redesign v2 renames: Library is now Gallery, People & pets is Faces,
 * Said is Speech, Brand kit is Brand; Projects is new).
 */
export const NAV_COPY = {
  gallery: 'Gallery',
  faces: 'Faces',
  speech: 'Speech',
  moments: 'Moments',
  brand: 'Brand',
  projects: 'Projects',
  settings: 'Settings',
} as const;

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
  /** The same state as `cached`, where the Gallery names it (tile badge, Where column). */
  partly: 'Partly on this Mac',
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

/** Production Studio: productions, the shot list, finishing and publishing. */
export const PRODUCTION_COPY = {
  /** The Studio switch option, the Mac sidebar entry and its page title. */
  productions: 'Productions',
  macSubtitle: 'Plan a story, film what is missing, cut it.',
  newProduction: 'New production',
  emptyTitle: 'No productions yet',
  emptyBody:
    'Say what the video is about. The planner turns it into a shot list with a storyboard, then checks your library for each shot.',
  planShots: 'Plan my shots',
  planNote: 'Muse Spark plans the shots · Muse Image draws the storyboard',
  coverageNote: 'New clips are checked against this list as they upload.',
  filmMissing: 'Film missing',
  cutStory: 'Cut the story',
  openStory: 'Open the story',
  howToFilm: 'How to film',
  covered: 'Covered',
  missing: 'Missing',
  retry: 'Retry',
  planFailed: 'Planning stopped',
  directorsNotes: "Director's notes",
  notInPlan: 'Not in plan',
  finish: 'Finish',
  renderAndPublish: 'Render and publish',
  /** On a platform whose render failed: starts its render, captions and covers again. */
  renderAgain: 'Try again',
  publish: 'Publish',
  copyCaption: 'Copy caption',
  shareVideo: 'Share video',
  download: 'Download',
  makeMoreCovers: 'Make 3 more',
  brandKit: NAV_COPY.brand,
  saveBrandKit: 'Save brand',
} as const;

/** Mac Studio pages (redesign v2, V7 Short, V8 Production, V10 Productions): words used twice. */
export const MAC_STUDIO_COPY = {
  open: 'Open',
  openItsShort: 'Open its short',
  deleteProduction: 'Delete production…',
  productionOptions: 'Production options',
  checkAgain: 'Check again',
  /** Mac Shorts list (V11a): a row's ⋯ menu and the right column. */
  publish: 'Publish…',
  deleteShort: 'Delete short…',
  shortOptions: 'Short options',
} as const;

/** Status words of a production. */
export const PRODUCTION_STATUS_COPY = {
  planning: 'Planning',
  shooting: 'Shooting',
  cutting: 'Cutting',
  ready: 'Ready',
  published: 'Published',
  failed: 'Stopped',
} as const;

/** Format names, their length range and what each one is. */
export const FORMAT_COPY = {
  story: { name: 'Story', range: '45–90 s', line: 'Hook → story → payoff → outro' },
  short: { name: 'Short', range: '10–30 s', line: 'One idea, told fast' },
} as const;

/** Act names as the shot list and the acts strip print them. */
export const ACT_COPY = {
  hook: 'Hook',
  story: 'Story',
  payoff: 'Payoff',
  outro: 'Outro',
} as const;

/** Platform names on the Publish screen. */
export const PLATFORM_COPY = {
  tiktok: 'TikTok',
  reels: 'Reels',
  shorts: 'Shorts',
  feed: 'Feed',
} as const;

/** Cover style names (Style chips, cover labels, "Make 3 more · Bright"). */
export const COVER_STYLE_COPY = {
  bright: 'Bright',
  close_detail: 'Close detail',
  dramatic: 'Dramatic',
  illustrated: 'Illustrated',
  brand_scene: 'Brand scene',
  redrawn: 'Redrawn',
  key_art: 'Key art',
} as const;

/** Muse Image on the Publish, Production, Productions and project pages (boards V14–V17). */
export const MUSE_IMAGE_COPY = {
  cover: 'Cover',
  coverSource: 'drawn by Muse Image from your hook frame',
  style: 'Style',
  redrawing: 'Redrawing…',
  title: 'Title',
  showTitle: 'Show the title on the cover',
  titleText: 'Text',
  titleTextNote: '(set in your Brand font, max 32)',
  position: 'Position',
  titlePosition: 'Title position',
  top: 'Top',
  bottom: 'Bottom',
  redrawWithWords: 'Redraw with words',
  redrawHelp: 'Say how to change this cover. A new one is added; this one stays.',
  redraw: 'Redraw',
  useThisCover: 'Use this cover',
  downloadCover: 'Download cover',
  /** Production board (V15). */
  footageNote: 'Covered shots get a new storyboard drawn from the real frame, so the plan shows what you actually filmed.',
  storyboard: 'Storyboard',
  planned: 'Planned',
  fromFootage: 'From your footage',
  drawnFromFootage: 'Drawn from your footage',
  plannedCaption: 'Planned sketch, drawn before filming',
  drawingFromFootage: 'Drawing from your footage…',
  redrawFromFootage: 'Redraw from footage',
  hookFrameNote: 'uses the moment’s hook frame',
  /** Key art (V16, V17). */
  newArt: 'New art',
  download: 'Download',
  drawnFrom: 'Drawn from',
  drawingProjectArt: 'Drawing new art from your best moments…',
  drawingKeyArt: 'Drawing key art…',
  productionArtNote: 'Key art · drawn by Muse Image from the covered shots, no text',
  productionArtPending: 'Key art is drawn once planning finishes',
  useAsCover: 'Use as cover',
  openProduction: 'Open production',
} as const;

/** The suggestion chips under Redraw with words. */
export const REDRAW_SUGGESTIONS = ['golden hour', 'moodier', 'comic style', 'closer crop'] as const;

/**
 * "Key art · drawn by Muse Image from 4 moments".
 * @param moments - How many moments it was drawn from.
 * @returns The label.
 */
export const projectArtLabel = (moments: number): string =>
  `Key art · drawn by Muse Image from ${String(moments)} ${moments === 1 ? 'moment' : 'moments'}`;

/**
 * Under the large footage board: "Drawn by Muse Image from your footage at 60th birthday · 0:43–0:49".
 * @param match - The covering moment's line.
 * @returns The caption.
 */
export const footageCaption = (match: string): string => `Drawn by Muse Image from your footage at ${match}`;
