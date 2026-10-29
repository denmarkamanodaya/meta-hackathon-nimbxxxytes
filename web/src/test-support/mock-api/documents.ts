// Mock iRead documents for `npm run dev:mock`: three read samples (a water bill, a rates notice, a
// card from Sam; from documents.json), and every upload walks reading → ready on the clock as a
// letter from the bank. Questions get canned answers in plain words; the voice is a soft tone WAV
// (the mock has no MMS-TTS). The card from Sam has no summary voice, so the no-voice line shows.
// The same rules the API enforces: the four file types, 20 MB, a title of 1–60 characters, no
// question while the page is read (VALIDATION_FAILED), a part inside the text.
import { DOCUMENT_MAX_BYTES, DOCUMENT_TYPES, MAX_DOCUMENT_TITLE_CHARS, wordCount } from '../../core/iread/documents';
import { parseDocument } from '../../services/api/parse-documents';
import type { DocumentDetail, DocumentSummary } from '../../services/api/types';
import { wavDataUrl } from '../../services/media/wav-url';
import documentsJson from '../fixtures/documents.json';
import { fail, json, type MockRoute } from './reply';
import { paperPage } from './thumbs';

/** How long the mock takes to read an uploaded page, ms. */
export const READ_MS = 4000;

/** About how long one part of the full text is, characters (the API's rule). */
const PART_CHARS = 400;

/** One document and, while it is read, when the read started. */
interface MockDocument {
  doc: DocumentDetail;
  readStartedAt: number | null;
}

/** What an uploaded page reads as. */
const UPLOADED: Pick<DocumentDetail, 'title' | 'kind' | 'sender' | 'date' | 'summary' | 'text'> = {
  title: 'Letter from Harbour Bank',
  kind: 'letter',
  sender: 'Harbour Bank',
  date: '2026-10-27',
  summary: 'Your new bank card is on its way. It should arrive within 7 days. Your old card stops working on 30 November.',
  text:
    'HARBOUR BANK. 27 October 2026. Dear customer, your new bank card is on its way. It should arrive within 7 days. ' +
    'When it arrives, sign the back and start using it. Your old card stops working on 30 November 2026. ' +
    'Please cut your old card in half and throw it away. If your new card has not arrived by 10 November, call us on 13 22 55. ' +
    'We will never ask for your PIN by phone or email.',
};

/** Canned answers by what the question is about. */
const ANSWERS: Record<string, { pay?: string; when?: string; about: string }> = {
  doc_water: {
    pay: 'You can pay by phone on 1300 555 019, online, or at any post office. Have your account number ready: 4471 2093.',
    when: 'Please pay $142.60 by 14 November.',
    about:
      'This is your water bill from Sunvale Water. You owe $142.60. Please pay by 14 November. You used a little less water than last time. You can pay by phone on 1300 555 019, online, or at the post office.',
  },
  doc_rates: {
    pay: 'You can pay with BPAY, biller code 4455, online, or at the council office. You can pay it all, or in four parts of $465.',
    when: 'The first part, $465, is due on 30 November. The whole year is $1,860.',
    about:
      'This is your council rates notice. The rates for the year are $1,860. You can pay it all by 30 November, or in four parts of $465. Pensioners may get a 50% discount: call 08 9555 0100.',
  },
  doc_sam: {
    when: 'Sam is visiting on Sunday the 3rd of November.',
    about: 'This is a birthday card from Sam. He says happy birthday. He is visiting on the 3rd of November with the kids, and they will bring lunch and a cake.',
  },
};

/** A soft tone that lasts about as long as the words would take to say (≈ 3 words a second). */
const voiceFor = (text: string): string =>
  wavDataUrl({ seconds: Math.min(8, Math.max(1.5, wordCount(text) / 3)), hz: 330, sampleRate: 8000, level: 0.05 });

/**
 * The full text in parts of about 400 characters, cut at sentence ends.
 * @param text - The text.
 * @returns The parts (at least one).
 */
export function splitParts(text: string): string[] {
  const sentences = text.match(/[^.!?]+[.!?]*\s*/g) ?? [text];
  const parts: string[] = [];
  let part = '';
  for (const sentence of sentences) {
    if (part !== '' && part.length + sentence.length > PART_CHARS) {
      parts.push(part.trim());
      part = '';
    }
    part += sentence;
  }
  if (part.trim() !== '' || parts.length === 0) parts.push(part.trim());
  return parts;
}

/**
 * A canned answer for a question about a document.
 * @param doc - The document.
 * @param question - The question.
 * @returns The answer.
 */
export function mockAnswer(doc: DocumentDetail, question: string): string {
  const canned = ANSWERS[doc.id] ?? { about: doc.summary };
  const lower = question.toLowerCase();
  if (/\b(pay|paying|payment)\b/.test(lower)) return canned.pay ?? 'The page does not say how to pay.';
  if (/\b(when|due|date|by)\b/.test(lower)) return canned.when ?? 'The page does not give a date for that.';
  if (/\b(doctor|medicine|pet|dog|cat)\b/.test(lower)) return 'The page does not say.';
  return canned.about;
}

/** The fixtures with drawn pages and tone voices (none for a fixture whose voice is null). */
function samples(): MockDocument[] {
  return documentsJson.map((raw) => {
    const doc = parseDocument(raw);
    if (doc === null) throw new Error(`mock fixture documents.json ${raw.id} does not parse`);
    return { doc: drawn(doc, doc.summary_audio_url !== null), readStartedAt: null };
  });
}

/** The document's pages drawn, and its summary voiced when `hasVoice`. */
function drawn(doc: DocumentDetail, hasVoice: boolean): DocumentDetail {
  const count = Math.max(1, doc.page_count);
  const parts = splitParts(doc.text);
  const perPage = Math.ceil(parts.length / count);
  const pages = Array.from({ length: count }, (_, index) => ({
    n: index + 1,
    image_url: paperPage(doc.sender, parts.slice(index * perPage, (index + 1) * perPage).join(' ') || doc.text),
  }));
  return {
    ...doc,
    pages,
    thumb_url: pages[0]?.image_url ?? null,
    summary_audio_url: hasVoice ? voiceFor(doc.summary) : null,
  };
}

const summaryOf = (doc: DocumentDetail): DocumentSummary => {
  const { id, title, kind, sender, date, status, page_count, thumb_url, created_at, error } = doc;
  return { id, title, kind, sender, date, status, page_count, thumb_url, created_at, error };
};

/**
 * Builds the document routes.
 * @param now - Clock in ms.
 * @returns The routes, and the documents as they are now (for the intent mock).
 */
export function createDocumentsMock(now: () => number): { routes: MockRoute[]; list: () => DocumentSummary[] } {
  let docs: MockDocument[] = samples();
  let nextId = 1;

  /** The document as GET reads it now: a read in flight finishes on the clock. */
  const view = (entry: MockDocument): DocumentDetail => {
    if (entry.readStartedAt === null || now() - entry.readStartedAt < READ_MS) return entry.doc;
    entry.readStartedAt = null;
    entry.doc = drawn({ ...entry.doc, ...UPLOADED, status: 'ready' }, true);
    return entry.doc;
  };
  const find = (id: string) => docs.find((entry) => entry.doc.id === decodeURIComponent(id));
  const list = () => docs.map((entry) => summaryOf(view(entry)));

  const routes: MockRoute[] = [
    ['GET', /^\/documents$/, () => json(list(), 250)],
    ['POST', /^\/documents$/, (_m, req) => {
      const body = (req.body ?? {}) as { filename?: unknown; content_type?: unknown; size_bytes?: unknown };
      const type = DOCUMENT_TYPES.find((each) => each === body.content_type);
      if (type === undefined) return fail(400, 'VALIDATION_FAILED', 'content_type must be a JPEG, PNG, WebP or PDF');
      if (typeof body.size_bytes !== 'number' || body.size_bytes <= 0 || body.size_bytes > DOCUMENT_MAX_BYTES) {
        return fail(400, 'VALIDATION_FAILED', 'size_bytes must be 1 byte to 20 MB');
      }
      const id = `doc_new_${String(nextId)}`;
      nextId += 1;
      const doc: DocumentDetail = {
        id,
        title: '',
        kind: 'other',
        sender: '',
        date: '',
        status: 'uploading',
        page_count: type === 'application/pdf' ? 2 : 1,
        thumb_url: null,
        created_at: new Date(now()).toISOString(),
        error: null,
        summary: '',
        text: '',
        pages: [],
        summary_audio_url: null,
      };
      docs = [{ doc, readStartedAt: null }, ...docs];
      return json({ document_id: id, upload_url: `/mock-s3/documents/${id}` }, 300, 201);
    }],
    ['POST', /^\/documents\/([^/]+)\/complete$/, (m) => {
      const entry = find(m[1] ?? '');
      if (entry === undefined) return fail(404, 'NOT_FOUND', 'No such document');
      if (entry.doc.status === 'uploading') {
        entry.doc = { ...entry.doc, status: 'reading' };
        entry.readStartedAt = now();
      }
      return json({ document_id: entry.doc.id, status: view(entry).status }, 200, 202);
    }],
    ['GET', /^\/documents\/([^/]+)$/, (m) => {
      const entry = find(m[1] ?? '');
      return entry === undefined ? fail(404, 'NOT_FOUND', 'No such document') : json(view(entry), 250);
    }],
    ['PATCH', /^\/documents\/([^/]+)$/, (m, req) => {
      const entry = find(m[1] ?? '');
      if (entry === undefined) return fail(404, 'NOT_FOUND', 'No such document');
      const raw = ((req.body ?? {}) as { title?: unknown }).title;
      const title = typeof raw === 'string' ? raw.trim() : '';
      if (title === '' || Array.from(title).length > MAX_DOCUMENT_TITLE_CHARS) {
        return fail(400, 'VALIDATION_FAILED', `title must be 1–${String(MAX_DOCUMENT_TITLE_CHARS)} characters`);
      }
      entry.doc = { ...view(entry), title };
      return json(entry.doc, 300);
    }],
    ['DELETE', /^\/documents\/([^/]+)$/, (m) => {
      const entry = find(m[1] ?? '');
      if (entry === undefined) return fail(404, 'NOT_FOUND', 'No such document');
      docs = docs.filter((each) => each !== entry);
      return { kind: 'empty', status: 204 };
    }],
    ['POST', /^\/documents\/([^/]+)\/ask$/, (m, req) => {
      const entry = find(m[1] ?? '');
      if (entry === undefined) return fail(404, 'NOT_FOUND', 'No such document');
      const doc = view(entry);
      if (doc.status !== 'ready') return fail(400, 'VALIDATION_FAILED', 'The page is still being read. Ask again in a few seconds.');
      const raw = ((req.body ?? {}) as { question?: unknown }).question;
      const question = typeof raw === 'string' ? raw.trim() : '';
      if (question === '' || question.length > 500) return fail(400, 'VALIDATION_FAILED', 'question must be 1–500 characters');
      const answer = mockAnswer(doc, question);
      return json({ question, answer, audio_url: voiceFor(answer) }, 1800);
    }],
    ['POST', /^\/documents\/([^/]+)\/speak$/, (m, req) => {
      const entry = find(m[1] ?? '');
      if (entry === undefined) return fail(404, 'NOT_FOUND', 'No such document');
      const doc = view(entry);
      if (doc.status !== 'ready') return fail(400, 'VALIDATION_FAILED', 'The page is still being read.');
      const parts = splitParts(doc.text);
      const part = ((req.body ?? {}) as { part?: unknown }).part;
      if (typeof part !== 'number' || !Number.isInteger(part) || part < 0 || part >= parts.length) {
        return fail(400, 'VALIDATION_FAILED', `part must be 0–${String(parts.length - 1)}`);
      }
      const text = parts[part] ?? '';
      return json({ part, parts: parts.length, text, audio_url: voiceFor(text) }, 700);
    }],
  ];
  return { routes, list };
}
