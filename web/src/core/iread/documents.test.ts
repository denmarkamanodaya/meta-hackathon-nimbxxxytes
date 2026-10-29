import { describe, expect, it } from 'vitest';
import {
  DOCUMENT_MAX_BYTES,
  docBadge,
  docDate,
  docFromLine,
  docKindLabel,
  docMetaLine,
  docStageRows,
  docTitle,
  documentCount,
  documentFileProblem,
  documentTitleProblem,
  documentType,
  pageCount,
  isUploadStuck,
  readStep,
  shownDocument,
  UPLOAD_STUCK_MS,
  wordCount,
  youAsked,
} from './documents';

describe('isUploadStuck and shownDocument (the stuck-upload rule)', () => {
  const added = '2026-10-29T01:00:00.000Z';
  const addedMs = Date.parse(added);
  const doc = (status: 'uploading' | 'reading' | 'ready' | 'failed', error: string | null = null) => ({ status, created_at: added, error });

  it('calls an upload stuck only once it is older than two minutes', () => {
    expect(UPLOAD_STUCK_MS).toBe(120_000);
    expect(isUploadStuck(doc('uploading'), addedMs + 30_000)).toBe(false);
    expect(isUploadStuck(doc('uploading'), addedMs + UPLOAD_STUCK_MS)).toBe(false);
    expect(isUploadStuck(doc('uploading'), addedMs + UPLOAD_STUCK_MS + 1)).toBe(true);
  });

  it('never calls a document stuck once its file arrived, or with an unreadable date', () => {
    const late = addedMs + 3_600_000;
    expect(isUploadStuck(doc('reading'), late)).toBe(false);
    expect(isUploadStuck(doc('ready'), late)).toBe(false);
    expect(isUploadStuck(doc('failed'), late)).toBe(false);
    expect(isUploadStuck({ status: 'uploading', created_at: 'soon' }, late)).toBe(false);
  });

  it('shows a stuck upload as a failure that says so, never as Reading…', () => {
    const late = addedMs + UPLOAD_STUCK_MS + 1;
    const shown = shownDocument({ ...doc('uploading'), kind: 'other' as const, title: '' }, late);

    expect(shown).toMatchObject({ status: 'failed', error: "This upload didn't finish" });
    expect(docBadge(shown)).toEqual({ label: 'Failed', tone: 'danger' });
    expect(docTitle(shown)).toBe('Untitled letter');
    expect(shownDocument(doc('uploading'), addedMs + 1000)).toEqual(doc('uploading'));
  });
});

const ready = { sender: 'Sunvale Water', date: '2026-10-24', status: 'ready' as const, page_count: 1, error: null };

describe('documentType', () => {
  it('keeps an accepted type and reads an empty one from the extension', () => {
    expect(documentType('bill.jpg', 'image/jpeg')).toBe('image/jpeg');
    expect(documentType('Rates.PDF', '')).toBe('application/pdf');
    expect(documentType('scan.webp', '')).toBe('image/webp');
  });

  it('refuses a type the API does not read, even with a readable extension', () => {
    expect(documentType('photo.heic', 'image/heic')).toBeNull();
    expect(documentType('notes.jpg', 'text/plain')).toBeNull();
    expect(documentType('notes.txt', '')).toBeNull();
  });
});

describe('documentFileProblem', () => {
  it('passes a photo or a PDF up to 20 MB', () => {
    expect(documentFileProblem({ name: 'a.pdf', type: 'application/pdf', size: DOCUMENT_MAX_BYTES })).toBeNull();
  });

  it('says why a file cannot be read: type, empty, too big', () => {
    expect(documentFileProblem({ name: 'a.mov', type: 'video/quicktime', size: 10 })).toMatch(/photos/);
    expect(documentFileProblem({ name: 'a.png', type: 'image/png', size: 0 })).toBe('This file is empty.');
    expect(documentFileProblem({ name: 'a.png', type: 'image/png', size: DOCUMENT_MAX_BYTES + 1 })).toMatch(/20 MB/);
  });
});

describe('document words', () => {
  it('names the kind, pages and documents', () => {
    expect(docKindLabel('bill')).toBe('Bill');
    expect(pageCount(1)).toBe('1 page');
    expect(pageCount(2)).toBe('2 pages');
    expect(documentCount(1)).toBe('1 document');
    expect(documentCount(3)).toBe('3 documents');
  });

  it('formats an ISO day short or long and keeps any other wording', () => {
    expect(docDate('2026-10-24', 'short')).toBe('24 Oct');
    expect(docDate('2026-10-02', 'long')).toBe('2 October');
    expect(docDate('Monday 3rd', 'short')).toBe('Monday 3rd');
    expect(docDate('', 'long')).toBe('');
  });

  it('writes the list line with or without pages, and what happens while it reads', () => {
    expect(docMetaLine(ready, true)).toBe('Sunvale Water · 24 Oct · 1 page');
    expect(docMetaLine(ready, false)).toBe('Sunvale Water · 24 Oct');
    expect(docMetaLine({ ...ready, sender: '' }, false)).toBe('24 Oct');
    expect(docMetaLine({ ...ready, status: 'reading' }, true)).toBe('Muse Spark is reading it…');
    expect(docMetaLine({ ...ready, status: 'failed', error: 'Too dark to read' }, true)).toBe('Too dark to read');
  });

  it('writes the from line', () => {
    expect(docFromLine(ready)).toBe('From Sunvale Water · 24 October');
    expect(docFromLine({ sender: '', date: '' })).toBe('');
  });

  it('shows Reading… for a title not read yet, and Untitled for an empty read one', () => {
    expect(docTitle({ title: 'Water bill', status: 'ready' })).toBe('Water bill');
    expect(docTitle({ title: '', status: 'reading' })).toBe('Reading…');
    expect(docTitle({ title: ' ', status: 'failed' })).toBe('Untitled letter');
  });

  it('counts words and quotes the question', () => {
    expect(wordCount(' You owe  $142.60. ')).toBe(3);
    expect(youAsked(' how do I pay? ')).toBe('You asked: “how do I pay?”');
  });
});

describe('documentTitleProblem', () => {
  it('takes 1–60 characters after trimming', () => {
    expect(documentTitleProblem(' Water bill ')).toBeNull();
    expect(documentTitleProblem('x'.repeat(60))).toBeNull();
    expect(documentTitleProblem('  ')).toBe('Give the letter a title.');
    expect(documentTitleProblem('x'.repeat(61))).toBe('Use 60 characters or fewer.');
  });
});

describe('readStep (the reading-progress rule)', () => {
  it('answers at once when read, waits while uploading or reading, stops when failed', () => {
    expect(readStep('ready')).toBe('ready');
    expect(readStep('reading')).toBe('wait');
    expect(readStep('uploading')).toBe('wait');
    expect(readStep('failed')).toBe('failed');
  });
});

describe('docBadge', () => {
  it('says Reading… while busy, Failed, else the kind', () => {
    expect(docBadge({ status: 'uploading', kind: 'other' })).toEqual({ label: 'Reading…', tone: 'neutral' });
    expect(docBadge({ status: 'reading', kind: 'other' })).toEqual({ label: 'Reading…', tone: 'neutral' });
    expect(docBadge({ status: 'failed', kind: 'bill' })).toEqual({ label: 'Failed', tone: 'danger' });
    expect(docBadge({ status: 'ready', kind: 'bill' })).toEqual({ label: 'Bill', tone: 'success' });
  });
});

describe('docStageRows', () => {
  const states = (status: Parameters<typeof docStageRows>[0]) => docStageRows(status).map((row) => `${row.label}:${row.state}`);

  it('goes Pages, then Read, then Backup voice', () => {
    expect(states('uploading')).toEqual(['Pages:now', 'Read:next', 'Backup voice:next']);
    expect(states('reading')).toEqual(['Pages:done', 'Read:now', 'Backup voice:next']);
    expect(states('ready')).toEqual(['Pages:done', 'Read:done', 'Backup voice:done']);
  });

  it('names the model of each stage', () => {
    expect(docStageRows('reading').map((row) => row.model)).toEqual(['', 'Muse Spark', 'MMS-TTS backup']);
  });
});
