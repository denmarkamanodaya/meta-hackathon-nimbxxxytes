// iListen rules the PWA and the Mac app share (phase 31, mock docs/design/ilisten): the words,
// which files can be listened to, a listen's title and lines, the check score pill, and the
// progress list with the check loop. Pure: no IO, no clock.
import { formatDuration } from '../format';
import { titleProblem } from '../copy';
import type { StageState } from '../guides';
import type { ListenDetail, ListenStatus, ListenStep, ListenSummary, ListenVersion } from '../../services/api/types';
import { heardLabel, languageBoth, languageLabel } from './languages';

/** User-facing words for iListen. */
export const ILISTEN_COPY = {
  section: 'iListen',
  isNew: 'New',
  dropTitle: 'Drop a recording or a video',
  dropBody: 'Any language, even mixed. nimbytes keeps only the audio, then writes a summary in your language.',
  phoneTitle: 'Listen to a recording',
  phoneBody: 'Any language, even mixed. Summary in your language.',
  dropHere: 'Drop it here',
  summaryIn: 'Summary in',
  chooseFile: 'Choose a file',
  uploading: 'Uploading…',
  addFailed: 'Could not add the recording',
  yourRecordings: 'Your recordings',
  emptyTitle: 'No recordings yet',
  emptyBody: 'Choose a recording or a video, and nimbytes tells you what was said, in your language.',
  fromLibrary: 'From your library',
  heard: 'Heard',
  checked: 'Checked',
  passed: 'Passed',
  needsCheck: 'Needs a human check',
  checkBody: 'Every line checked against what was said.',
  checkHow: 'Each translation is turned back into the language spoken and compared. Pass is 90%.',
  checkNeedsBody: 'Some lines stayed below 90% after three tries. Check the marked lines by ear.',
  summary: 'Summary',
  readToMe: 'Read it to me',
  stopReading: 'Stop reading',
  askAbout: 'Ask about it…',
  whatWasSaid: 'What was said',
  original: 'Original',
  fixedIn: (version: number) => `fixed in v${String(version)}`,
  listeningTitle: 'Listening…',
  leaveNote: 'You can leave this page. iListen keeps working and the list shows when it is done.',
  failedTitle: 'This recording could not be listened to',
  failedBody: 'Try another file: a clear recording with someone speaking.',
  untitled: 'Untitled recording',
  rename: 'Rename',
  renameListen: 'Rename…',
  renameTitle: 'Rename recording',
  titleField: 'Title',
  titleEmpty: 'Give the recording a title.',
  options: 'Recording options',
  listen: 'Listen',
  starting: 'Starting…',
  changing: 'Writing it again…',
  linesLink: (count: number) => `What was said (${String(count)} ${count === 1 ? 'line' : 'lines'})`,
  noVoiceFor: (label: string) => `No ${label} voice on this device, so the English voice reads it.`,
} as const;

/** The longest title the API stores, in characters after tidying. */
export const MAX_LISTEN_TITLE_CHARS = 80;

/** The largest file the API takes, bytes (300 MB). */
export const LISTEN_MAX_BYTES = 300 * 1024 * 1024;

/** How large a file one build may send, and what the picker says above it. */
export interface ListenUploadLimit {
  maxBytes: number;
  tooBig: string;
}

/** The PWA sends a file straight over HTTP: the API's own cap. */
export const PWA_LISTEN_LIMIT: ListenUploadLimit = {
  maxBytes: LISTEN_MAX_BYTES,
  tooBig: 'This file is over 300 MB. Try a shorter recording.',
};

/**
 * The Mac app sends a body over the native bridge as base64 inside a 120 s call, so it keeps to
 * 50 MB; a longer recording goes in as a library clip (which uploads in parts) and is listened to there.
 */
export const MAC_LISTEN_LIMIT: ListenUploadLimit = {
  maxBytes: 50 * 1024 * 1024,
  tooBig: 'On the Mac, files up to 50 MB. For longer recordings, add the video to your library and press Listen on it.',
};

/** Every check score at or above this passes, percent. */
export const PASS_SCORE = 90;

/** The audio types the API names; any `video/*` is taken too. */
export const LISTEN_AUDIO_TYPES = [
  'audio/mpeg',
  'audio/mp4',
  'audio/x-m4a',
  'audio/aac',
  'audio/wav',
  'audio/x-wav',
  'audio/ogg',
  'audio/flac',
  'audio/webm',
] as const;

/** What the file inputs offer. */
export const LISTEN_ACCEPT = 'audio/*,video/*';

const BY_EXTENSION: Record<string, string> = {
  mp3: 'audio/mpeg',
  m4a: 'audio/x-m4a',
  aac: 'audio/aac',
  wav: 'audio/wav',
  ogg: 'audio/ogg',
  oga: 'audio/ogg',
  flac: 'audio/flac',
  weba: 'audio/webm',
  webm: 'video/webm',
  mp4: 'video/mp4',
  m4v: 'video/mp4',
  mov: 'video/quicktime',
};

/**
 * The file's type as the API names it: its own type when taken, else from its extension (a picker
 * may leave the type empty, or call an m4a `audio/m4a`).
 * @param name - The file name.
 * @param type - The browser's type for it ("" when unknown).
 * @returns The type, or null when the API does not take it.
 */
export function listenType(name: string, type: string): string | null {
  const own = type.toLowerCase();
  if (own.startsWith('video/') || LISTEN_AUDIO_TYPES.some((each) => each === own)) return own;
  const extension = name.split('.').pop()?.toLowerCase() ?? '';
  return BY_EXTENSION[extension] ?? null;
}

/**
 * What is wrong with a file for iListen, or null when it can be listened to.
 * @param file - Its name, type and size.
 * @param limit - This build's size cap and its words.
 * @returns The problem, as the page says it, or null.
 */
export function listenFileProblem(file: { name: string; type: string; size: number }, limit: ListenUploadLimit): string | null {
  if (listenType(file.name, file.type) === null) return 'nimbytes listens to sound files (MP3, M4A, WAV, AAC, OGG, FLAC) and videos.';
  if (file.size === 0) return 'This file is empty.';
  if (file.size > limit.maxBytes) return limit.tooBig;
  return null;
}

/** Statuses during which the listen is not done (poll it). */
export const isListenBusy = (status: ListenStatus): boolean => status === 'uploading' || status === 'listening';

/**
 * The title to show: Spark's, else "Listening…" while it works, else the file or clip name.
 * @param listen - The listen.
 * @returns The title.
 */
export function listenTitle(listen: Pick<ListenSummary, 'title' | 'status' | 'source_name'>): string {
  if (listen.title.trim() !== '') return listen.title;
  if (listen.source_name.trim() !== '') return listen.source_name;
  return isListenBusy(listen.status) ? ILISTEN_COPY.listeningTitle : ILISTEN_COPY.untitled;
}

/**
 * "1 recording", "5 recordings".
 * @param count - Recordings.
 * @returns The words.
 */
export const recordingCount = (count: number): string => `${String(count)} ${count === 1 ? 'recording' : 'recordings'}`;

/**
 * "1 speaker", "2 speakers".
 * @param count - Speakers.
 * @returns The words.
 */
export const speakerCount = (count: number): string => `${String(count)} ${count === 1 ? 'speaker' : 'speakers'}`;

/**
 * "→ English".
 * @param target - The output language.
 * @returns The words.
 */
export const toTarget = (target: string): string => `→ ${languageLabel(target)}`;

const joined = (parts: readonly string[]): string => parts.filter((part) => part !== '').join(' · ');

/**
 * The facts after the language chips: "0:26 · 2 speakers"; a clip not yet understood says
 * "From your library · 3:12".
 * @param listen - The listen.
 * @returns The line ("" when nothing is known yet).
 */
export function listenFacts(listen: Pick<ListenSummary, 'duration_ms' | 'speakers' | 'source_kind' | 'languages'>): string {
  const length = listen.duration_ms === null ? '' : formatDuration(listen.duration_ms / 1000);
  if (listen.languages.length === 0) return joined([listen.source_kind === 'clip' ? ILISTEN_COPY.fromLibrary : '', length]);
  return joined([length, listen.speakers > 0 ? speakerCount(listen.speakers) : '']);
}

/** The pill's colour role. */
export type ListenPillTone = 'success' | 'warning' | 'accent' | 'danger' | 'neutral';

/** A row's or a page's check pill. */
export interface ListenPill {
  label: string;
  tone: ListenPillTone;
}

const STEP_WORDS: Record<ListenStep, string> = {
  audio: 'Taking the sound…',
  transcribe: 'Transcribing…',
  understand: 'Understanding…',
  check: 'Checking',
  voice: 'Making the voice…',
};

/**
 * The check pill: "Checked 100% · v2" (a fix was needed), "Checked 98%", "Needs a human check ·
 * 84%", "Checking v1…" while the loop runs; `isShort` (the phone list) keeps only the score.
 * @param listen - The listen.
 * @param isShort - Only the score once checked.
 * @returns The pill.
 */
export function listenPill(listen: Pick<ListenSummary, 'status' | 'step' | 'version' | 'confidence' | 'passed'>, isShort = false): ListenPill {
  if (listen.status === 'uploading') return { label: ILISTEN_COPY.uploading, tone: 'accent' };
  if (listen.status === 'failed') return { label: 'Failed', tone: 'danger' };
  if (listen.status === 'listening') {
    if (listen.step === 'check') return { label: `Checking v${String(listen.version)}…`, tone: 'accent' };
    return { label: listen.step === null ? ILISTEN_COPY.listeningTitle : STEP_WORDS[listen.step], tone: 'accent' };
  }
  if (listen.confidence === null) return { label: 'Ready', tone: 'success' };
  const score = `${String(listen.confidence)}%`;
  if (!listen.passed) return { label: isShort ? score : `${ILISTEN_COPY.needsCheck} · ${score}`, tone: 'warning' };
  if (isShort) return { label: score, tone: 'success' };
  return { label: listen.version > 1 ? `${ILISTEN_COPY.checked} ${score} · v${String(listen.version)}` : `${ILISTEN_COPY.checked} ${score}`, tone: 'success' };
}

/** One row of the progress list (Audio → Transcribe → Understand → Check → Voice). */
export interface ListenStageRow {
  id: ListenStep;
  label: string;
  /** What it does or found ("Meta Voice Transcribe · 3 speakers"). */
  model: string;
  state: StageState;
}

const STAGE_ORDER: readonly ListenStep[] = ['audio', 'transcribe', 'understand', 'check', 'voice'];

const STAGE_LABEL: Record<ListenStep, string> = {
  audio: 'Audio',
  transcribe: 'Transcribe',
  understand: 'Understand',
  check: 'Check',
  voice: 'Voice',
};

function stageNote(id: ListenStep, listen: ListenDetail): string {
  switch (id) {
    case 'audio':
      return listen.source_kind === 'clip' ? 'Sound taken from the video' : 'Sound taken from the file';
    case 'transcribe':
      return joined([
        'Meta Voice Transcribe',
        listen.turns.length > 0 ? `${String(listen.turns.length)} lines` : '',
        listen.speakers > 0 ? speakerCount(listen.speakers) : '',
      ]);
    case 'understand':
      return joined(['Muse Spark', listen.languages.length > 0 ? `heard ${listen.languages.map((each) => `${languageBoth(each.code)} ${String(each.share)}%`).join(', ')}` : '']);
    case 'check':
      return `Muse Spark · version ${String(listen.version)}`;
    case 'voice':
      return 'Read-aloud of the summary';
  }
}

/**
 * The progress list while it listens: the steps before the running one are done; an upload has
 * Audio next; a ready (or failed) listen has every row done.
 * @param listen - The listen.
 * @returns One row per step, in order.
 */
export function listenStageRows(listen: ListenDetail): ListenStageRow[] {
  const at = listen.status === 'uploading' ? 0 : listen.status === 'listening' && listen.step !== null ? STAGE_ORDER.indexOf(listen.step) : STAGE_ORDER.length;
  return STAGE_ORDER.map((id, index) => ({
    id,
    label: STAGE_LABEL[id],
    model: stageNote(id, listen),
    state: index < at ? 'done' : index === at ? 'now' : 'next',
  }));
}

/** One line of the check loop under the Check row: "v1 · 75%" and what happened. */
export interface LoopLine {
  head: string;
  body: string;
}

/**
 * The check loop as lines: each checked version with its score and notes, "Fixing …" between a
 * failed version and the next, and "vN · checking…" for the version being checked.
 * @param versions - Every version made, oldest first.
 * @returns The lines, in order.
 */
export function loopLines(versions: readonly ListenVersion[]): LoopLine[] {
  const lines: LoopLine[] = [];
  versions.forEach((version, index) => {
    const name = `v${String(version.version)}`;
    if (version.confidence === null) {
      lines.push({ head: `${name} · checking…`, body: `pass is ${String(PASS_SCORE)}%, at most 3 versions` });
      return;
    }
    const notes = version.notes.join('; ');
    lines.push({ head: `${name} · ${String(version.confidence)}%`, body: version.passed ? ILISTEN_COPY.passed : notes });
    if (!version.passed && index < versions.length - 1) {
      lines.push({ head: 'Fixing the flagged lines', body: 'the other lines stay as they are' });
    }
  });
  return lines;
}

/**
 * A line's time ("0:05").
 * @param startMs - Its start.
 * @returns The time.
 */
export const turnTime = (startMs: number): string => formatDuration(startMs / 1000);

/**
 * The colour slot of a speaker or a language, by its place in the list (0, 1, 2, …), cycling
 * through the slots the CSS defines.
 * @param index - Its place.
 * @returns 0–3.
 */
export const colourSlot = (index: number): number => index % 4;

/**
 * The colour slot of a line's speaker: speakers in the order they first speak.
 * @param turns - Every line.
 * @returns The slot of each speaker label.
 */
export function speakerSlots(turns: readonly { speaker: string | null }[]): Map<string, number> {
  const slots = new Map<string, number>();
  for (const turn of turns) {
    if (turn.speaker !== null && !slots.has(turn.speaker)) slots.set(turn.speaker, colourSlot(slots.size));
  }
  return slots;
}

/**
 * The language chips of a row ("中文 60%", "日本語 40%").
 * @param listen - The listen.
 * @returns One per language heard.
 */
export const heardChips = (listen: Pick<ListenSummary, 'languages'>): string[] => listen.languages.map(heardLabel);

/**
 * What is wrong with a new title (trimmed, 1–80 characters), or null when it may be saved.
 * @param title - The typed title.
 * @returns The problem, or null.
 */
export const listenTitleProblem = (title: string): string | null => titleProblem(title, MAX_LISTEN_TITLE_CHARS, ILISTEN_COPY.titleEmpty);

/**
 * The page's line under the title: "mix.wav · 0:26 · 2 speakers".
 * @param listen - The listen.
 * @returns The line.
 */
export const listenSubLine = (listen: Pick<ListenSummary, 'source_name' | 'source_kind' | 'duration_ms' | 'speakers' | 'languages'>): string =>
  joined([listen.source_kind === 'clip' && listen.languages.length > 0 ? ILISTEN_COPY.fromLibrary : listen.source_kind === 'file' ? listen.source_name : '', listenFacts(listen)]);
