// User-facing words that the PWA and the Mac app share: section names, storage, the three
// processing steps and the short statuses. One home per string, so both apps name the same thing
// the same way.

/**
 * Section and tab names (redesign v2 renames: Library is now Gallery, People & pets is Faces,
 * Said is Speech, Brand kit is Brand; Projects is new; Features holds Guides and Shorts since the
 * Studio and its Productions were removed, owner ruling 2026-10-29).
 */
export const NAV_COPY = {
  gallery: 'Gallery',
  faces: 'Faces',
  speech: 'Speech',
  moments: 'Moments',
  brand: 'Brand',
  projects: 'Projects',
  features: 'Features',
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

/** Shorts: where shorts are made and kept. */
export const STUDIO_COPY = {
  /** The page title and its entry under Features. */
  shorts: 'Shorts',
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

/** Finishing and publishing a short. */
export const PRODUCTION_COPY = {
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

/** Mac Shorts pages (redesign v2, V7 Short): words used twice. */
export const MAC_STUDIO_COPY = {
  open: 'Open',
  /** Mac Shorts list (V11a): a row's ⋯ menu and the right column. */
  publish: 'Publish…',
  deleteShort: 'Delete short…',
  shortOptions: 'Short options',
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
  cutout: 'Cutout',
} as const;

/** Muse Image on the Publish and project pages (boards V14, V16, V17). */
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
  hookFrameNote: 'uses the moment’s hook frame',
  /** Key art (V16, V17). */
  newArt: 'New art',
  download: 'Download',
  drawnFrom: 'Drawn from',
  drawingProjectArt: 'Drawing new art from your best moments…',
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
 * A name or title over its limit: "Use 60 characters or fewer.".
 * @param max - The limit, characters.
 * @returns The problem.
 */
export const tooManyCharacters = (max: number): string => `Use ${String(max)} characters or fewer.`;

/** Find this on the clip player (board V18). */
export const FIND_COPY = {
  findThis: 'Find this',
  cutOut: 'Cut out',
  cost: '$0.01 per object · about 6 s',
  pickHint: 'Click an object to find it everywhere · Esc to cancel',
  /** The PWA says tap. */
  pickHintTouch: 'Tap an object to find it everywhere',
  cutHint: 'Click the thing to cut out · Esc to cancel',
  cutHintTouch: 'Tap the thing to cut out',
  tracking: 'Tracking it through this clip…',
  cutting: 'Cutting it out…',
  intro:
    'Pause on any frame, click Find this, then click an object: a mug, a dog, a car. nimbytes follows it through this clip and shows every other clip it appears in.',
  asideLabel: 'Where it appears',
  makeShort: 'Make a short from these',
  showAll: 'Show all in the Gallery',
  thisClip: 'This clip',
  cancel: 'Cancel',
  failed: 'Could not find it',
  cutFailed: 'Could not cut it out',
  tryAgain: 'Try again',
} as const;

/** The Cut out dialog (board V22). */
export const CUTOUT_COPY = {
  title: 'Cut out',
  close: 'Close',
  sticker: 'Sticker',
  stickerHint: 'Adds a white outline',
  cost: 'Transparent PNG at full size · $0.0025',
  wrongThing: 'Wrong thing? Click Find this on the player and pick it instead.',
  copy: 'Copy',
  copied: 'Copied',
  copiedLink: 'Link copied',
  download: 'Download PNG',
} as const;

/** Keep subject in frame on the Short page (board V19). */
export const REFRAME_COPY = {
  preview: 'Preview',
  centreCrop: 'Centre crop',
  followsSubject: 'Follows subject',
  centreNote: 'A centre crop keeps the middle of each shot, whatever moves.',
  followNote: 'The 9:16 frame follows each shot’s subject.',
  shotsTitle: 'What each shot follows',
  shotsHint: 'Click a subject to change it',
  subjectField: 'What this shot follows',
  finish: 'Finish',
  keepSubject: 'Keep subject in frame',
  keepSubjectHint:
    'For 9:16 posts, the frame follows each shot’s subject instead of cutting from the centre. Zoomed shots follow it too.',
  cost: 'About $0.01–0.02 per shot · up to 20 shots · done when the 9:16 renders',
  blurFaces: 'Blur hidden faces',
  blurFacesHint: 'Faces you hid in Faces',
  noSubject: 'No subject: centre crop',
  tracking: 'Tracking…',
  off: 'Off: 9:16 posts use a centre crop',
  failed: 'Tracking stopped; 9:16 posts use a centre crop',
  waiting: 'Not tracked yet',
  saveFailed: 'Could not change the subject',
} as const;

/** Settings › Faces and privacy, the screens and plates row (board V20). */
export const PRIVACY_COPY = {
  blurObjects: 'Also blur screens and number plates',
  newBadge: 'New',
  blurObjectsHint:
    'Phone and laptop screens and car plates are found in each shot and blurred in every short you make. Clips in your Gallery stay as filmed.',
  plate: '1AB 2CD',
  blurredCaption: 'In your short: the plate and the laptop screen are blurred',
  readableCaption: 'In your short: the plate and the laptop screen are readable',
  foundBy: 'Found by SAM 3.1 on the shots in each short, not on the whole clip.',
  cost: 'About $0.01 per shot that has a screen or plate check · the switch applies to new renders.',
  unavailable: 'Setting not available right now.',
} as const;

/** Cutout covers on the Publish page (board V21). */
export const CUTOUT_COVER_COPY = {
  make: 'Make a cutout cover',
  cost: 'About $0.0125 · about 20 s',
  background: 'Background',
  scene: 'Brand scene',
  blur: 'Blurred frame',
  sceneNote: 'Muse Image draws the scene behind your subject in your Brand colours. $0.01.',
  blurNote: 'The real frame, softly blurred, behind your subject. Free.',
  howMade: 'How it is made',
  steps: [
    '1 · SAM 3.1 cuts your real subject out of the hook frame',
    '2 · The title is set in your Brand font',
    '3 · The subject goes in front of the title, so it is the real person, never a lookalike',
  ],
} as const;
