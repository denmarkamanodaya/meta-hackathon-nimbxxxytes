// iRead rules the PWA and the Mac app share (phase 28, mocks V46–V51): the words, a document's
// kind, title, date and lines, which files can be read, the rename rule and the reading-progress
// rule and the stuck-upload rule. Pure: no IO, no clock (the caller passes the time).
import { titleProblem } from '../copy';
import type { StageState } from '../guides';
import type { DocKind, DocStatus, DocumentSummary } from '../../services/api/types';

/** User-facing words for iRead. */
export const IREAD_COPY = {
  section: 'iRead',
  snap: 'Snap a letter',
  choosePdf: 'Choose a PDF',
  yourLetters: 'Your letters',
  readToMe: 'Read it to me',
  stopReading: 'Stop reading',
  holdToAsk: 'Hold to ask a question',
  listening: 'Listening… let go to ask',
  thinking: 'Reading the page for your answer…',
  showPage: 'Show the page',
  hidePage: 'Hide the page',
  askAbout: 'Ask about it…',
  readWhole: 'Read the whole letter',
  done: 'Done',
  play: 'Play',
  pause: 'Pause',
  plannedBy: 'Planned by Muse Spark',
  answeredBy: 'Answered by Muse Spark',
  readAndAnswer: 'Read and answer',
  readNote: 'Read from the page by Muse Spark. Check the page for anything important.',
  voiceLabel: 'Your device\'s voice',
  /** Shown while the server\'s backup recording plays instead of the device voice. */
  backupVoiceLabel: 'Backup voice (MMS-TTS)',
  noVoice: 'Voice not available right now',
  readingTitle: 'Reading…',
  readingLine: 'Muse Spark is reading the page. This takes a few seconds.',
  failedTitle: 'This page could not be read',
  failedBody: 'Try another photo: flat, in good light, the whole page in view.',
  untitled: 'Untitled letter',
  emptyTitle: 'No letters yet',
  emptyBodyPhone: 'Snap a letter or a bill, or choose a PDF, and nimbytes reads it to you.',
  emptyBodyMac: 'Add a photo of a letter or a PDF with + in the Ask box, or upload one here.',
  uploadDocument: 'Upload a photo or PDF…',
  addDocument: 'Add a document…',
  addNote: 'A document: a photo of a letter, or a PDF',
  pickTitle: 'Add a document to your request',
  pickEmpty: 'No letters yet. Upload a photo or a PDF.',
  addOne: 'Add',
  uploading: 'Uploading…',
  addFailed: 'Could not add the letter',
  stuckTitle: "This upload didn't finish",
  stuckBody: 'The file never reached nimbytes. Pick it again, or delete it.',
  tryAgain: 'Try again',
  deleteStuck: 'Delete',
  ask: 'Ask',
  askLabel: 'Your question',
  askPlaceholder: 'How do I pay this?',
  rename: 'Rename',
  renameDocument: 'Rename…',
  renameTitle: 'Rename letter',
  titleField: 'Title',
  titleEmpty: 'Give the letter a title.',
  defaultQuestion: 'Tell me what this says',
  options: 'Letter options',
} as const;

/** The longest document title the API stores, in characters after trimming. */
export const MAX_DOCUMENT_TITLE_CHARS = 60;

/** The largest file the API takes, bytes (20 MB). */
export const DOCUMENT_MAX_BYTES = 20 * 1024 * 1024;

/** The file types the API reads: photos and PDFs. */
export const DOCUMENT_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'] as const;

/** One accepted file type. */
export type DocumentType = (typeof DOCUMENT_TYPES)[number];

/** What the file inputs offer (photos and PDFs); the phone's camera input takes `image/*`. */
export const DOCUMENT_ACCEPT = DOCUMENT_TYPES.join(',');

const BY_EXTENSION: Record<string, DocumentType> = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  pdf: 'application/pdf',
};

/**
 * The file's type as the API names it: its own type when accepted, else from its extension (a
 * picker may leave the type empty).
 * @param name - The file name.
 * @param type - The browser's type for it ("" when unknown).
 * @returns The type, or null when the API does not read it.
 */
export function documentType(name: string, type: string): DocumentType | null {
  const own = DOCUMENT_TYPES.find((each) => each === type.toLowerCase());
  if (own !== undefined) return own;
  if (type !== '') return null;
  const extension = name.split('.').pop()?.toLowerCase() ?? '';
  return BY_EXTENSION[extension] ?? null;
}

/**
 * What is wrong with a file for iRead, or null when it can be read.
 * @param file - Its name, type and size.
 * @returns The problem, as the page says it, or null.
 */
export function documentFileProblem(file: { name: string; type: string; size: number }): string | null {
  if (documentType(file.name, file.type) === null) return 'nimbytes reads photos (JPEG, PNG, WebP) and PDFs.';
  if (file.size === 0) return 'This file is empty.';
  if (file.size > DOCUMENT_MAX_BYTES) return 'This file is over 20 MB. Try a smaller photo or a shorter PDF.';
  return null;
}

const KIND_LABEL: Record<DocKind, string> = {
  letter: 'Letter',
  bill: 'Bill',
  form: 'Form',
  notice: 'Notice',
  label: 'Label',
  other: 'Other',
};

/**
 * The kind pill ("Bill").
 * @param kind - The document kind.
 * @returns The label.
 */
export const docKindLabel = (kind: DocKind): string => KIND_LABEL[kind];

/** Statuses during which the document is not read yet (poll it). */
export const isDocBusy = (status: DocStatus): boolean => status === 'uploading' || status === 'reading';

/**
 * How long a document may stay `uploading` before its upload counts as stuck, ms. The app sends
 * a file of at most 20 MB in one request that gives up well inside this.
 */
export const UPLOAD_STUCK_MS = 120_000;

/**
 * Whether the document's upload never finished: still `uploading` more than
 * {@link UPLOAD_STUCK_MS} after it was added (the app closed, or the file was refused on the way).
 * @param doc - Its status and when it was added (ISO-8601).
 * @param nowMs - The current instant, ms since the epoch.
 * @returns True when it will not be read without a new upload.
 */
export function isUploadStuck(doc: Pick<DocumentSummary, 'status' | 'created_at'>, nowMs: number): boolean {
  if (doc.status !== 'uploading') return false;
  const addedMs = Date.parse(doc.created_at);
  return Number.isFinite(addedMs) && nowMs - addedMs > UPLOAD_STUCK_MS;
}

/**
 * The document as the lists and pages show it: a stuck upload shows as a failure that says so
 * (never "Reading…" and never the reading stages); anything else is shown as it is.
 * @param doc - The document.
 * @param nowMs - The current instant, ms since the epoch.
 * @returns The document to draw.
 */
export function shownDocument<T extends Pick<DocumentSummary, 'status' | 'created_at' | 'error'>>(doc: T, nowMs: number): T {
  return isUploadStuck(doc, nowMs) ? { ...doc, status: 'failed', error: IREAD_COPY.stuckTitle } : doc;
}

/** A list row's badge and its colour role (the iGuide list's badge, for a letter). */
export interface DocBadge {
  label: string;
  tone: 'success' | 'danger' | 'neutral';
}

/**
 * The list badge: "Reading…" while it is read, "Failed", else the kind ("Bill") in the colour of
 * iGuide's "Ready".
 * @param doc - The list row.
 * @returns The badge.
 */
export function docBadge(doc: Pick<DocumentSummary, 'status' | 'kind'>): DocBadge {
  if (isDocBusy(doc.status)) return { label: IREAD_COPY.readingTitle, tone: 'neutral' };
  if (doc.status === 'failed') return { label: 'Failed', tone: 'danger' };
  return { label: docKindLabel(doc.kind), tone: 'success' };
}

/** One row of the reading progress list (Pages → Read → Voice). */
export interface DocStageRow {
  id: 'pages' | 'read' | 'voice';
  label: string;
  /** The model doing it ("" for the pages). */
  model: string;
  state: StageState;
}

const DOC_STAGES: readonly Omit<DocStageRow, 'state'>[] = [
  { id: 'pages', label: 'Pages', model: '' },
  { id: 'read', label: 'Read', model: 'Muse Spark' },
  { id: 'voice', label: 'Backup voice', model: 'MMS-TTS backup' },
];

/**
 * The progress list while a letter is read: the pages arrive while it uploads, Muse Spark reads
 * them next, then the voice is made; a read (or failed) letter has every row done.
 * @param status - The document's status.
 * @returns One row per stage, in order.
 */
export function docStageRows(status: DocStatus): DocStageRow[] {
  const at = status === 'uploading' ? 0 : status === 'reading' ? 1 : DOC_STAGES.length;
  return DOC_STAGES.map((stage, index) => ({ ...stage, state: index < at ? 'done' : index === at ? 'now' : 'next' }));
}

/**
 * The title to show: Spark's, else "Reading…" while it reads, else "Untitled letter".
 * @param doc - The document.
 * @returns The title.
 */
export function docTitle(doc: Pick<DocumentSummary, 'title' | 'status'>): string {
  if (doc.title.trim() !== '') return doc.title;
  return isDocBusy(doc.status) ? IREAD_COPY.readingTitle : IREAD_COPY.untitled;
}

/**
 * "1 page", "2 pages".
 * @param count - Pages.
 * @returns The words.
 */
export const pageCount = (count: number): string => `${String(count)} ${count === 1 ? 'page' : 'pages'}`;

/**
 * "1 document", "3 documents".
 * @param count - Documents.
 * @returns The words.
 */
export const documentCount = (count: number): string => `${String(count)} ${count === 1 ? 'document' : 'documents'}`;

const ISO_DAY = /^(\d{4})-(\d{2})-(\d{2})$/;
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

/**
 * The page's date as the lists say it: an ISO day becomes "24 Oct" (`short`) or "24 October"
 * (`long`); any other wording is kept as the page says it.
 * @param date - The document's date ("" when none).
 * @param style - `short` for the lists, `long` for a document's page.
 * @returns The date, or "".
 */
export function docDate(date: string, style: 'short' | 'long'): string {
  const match = ISO_DAY.exec(date.trim());
  if (match === null) return date.trim();
  const month = MONTHS[Number(match[2]) - 1];
  if (month === undefined) return date.trim();
  return `${String(Number(match[3]))} ${style === 'short' ? month.slice(0, 3) : month}`;
}

const joined = (parts: readonly string[]): string => parts.filter((part) => part !== '').join(' · ');

/**
 * The line under a row's title: "Sunvale Water · 24 Oct · 1 page" on the Mac (`withPages`),
 * "Sunvale Water · 24 Oct" on the phone; while it reads, what is happening.
 * @param doc - The document.
 * @param withPages - Add the page count (the Mac list).
 * @returns The line.
 */
export function docMetaLine(doc: Pick<DocumentSummary, 'sender' | 'date' | 'status' | 'page_count' | 'error'>, withPages: boolean): string {
  if (isDocBusy(doc.status)) return doc.status === 'uploading' ? IREAD_COPY.uploading : 'Muse Spark is reading it…';
  if (doc.status === 'failed') return doc.error ?? IREAD_COPY.failedTitle;
  return joined([doc.sender, docDate(doc.date, 'short'), withPages ? pageCount(doc.page_count) : '']);
}

/**
 * The line under a document's title on its page: "From Sunvale Water · 24 October".
 * @param doc - The document.
 * @returns The line ("" when the page names neither).
 */
export function docFromLine(doc: Pick<DocumentSummary, 'sender' | 'date'>): string {
  return joined([doc.sender === '' ? '' : `From ${doc.sender}`, docDate(doc.date, 'long')]);
}

/**
 * What is wrong with a new document title (trimmed, 1–60 characters), or null when it may be saved.
 * @param title - The typed title.
 * @returns The problem, or null.
 */
export const documentTitleProblem = (title: string): string | null => titleProblem(title, MAX_DOCUMENT_TITLE_CHARS, IREAD_COPY.titleEmpty);

/**
 * Words in a text ("Already read: 1 page, 74 words").
 * @param text - The text.
 * @returns How many words.
 */
export const wordCount = (text: string): number => text.split(/\s+/).filter((word) => word !== '').length;

/**
 * "You asked: “how do I pay?”".
 * @param question - The question.
 * @returns The line.
 */
export const youAsked = (question: string): string => `You asked: “${question.trim()}”`;

/** How often a document being read is asked again, ms. */
export const READ_POLL_MS = 1500;

/** How long the Ask box waits for a page to be read before it gives up, ms. */
export const READ_WAIT_MAX_MS = 180_000;

/** What reading a page means for the next step of an Ask job. */
export type ReadStep = 'wait' | 'ready' | 'failed';

/**
 * The reading-progress rule: a ready document answers at once, one being uploaded or read is
 * waited for, a failed one stops the job.
 * @param status - The document's status.
 * @returns The next step.
 */
export function readStep(status: DocStatus): ReadStep {
  if (status === 'ready') return 'ready';
  if (status === 'failed') return 'failed';
  return 'wait';
}
