// The dev mock's iRead routes answer valid wire bodies under the API's rules.
import { describe, expect, it } from 'vitest';
import { parseIntent } from '../../services/api/parse-ask';
import {
  parseCompleteDocument,
  parseCreateDocument,
  parseDocument,
  parseDocumentAnswer,
  parseDocumentList,
  parseDocumentPart,
} from '../../services/api/parse-documents';
import { READ_MS, splitParts } from './documents';
import { createMockApi, type MockReply, type MockRequest } from './router';

const req = (method: string, path: string, body: unknown = null): MockRequest => ({ method, path, query: new URLSearchParams(), body });

function bodyOf(reply: MockReply): unknown {
  if (reply.kind !== 'json') throw new Error(`expected json, got ${reply.kind}`);
  return reply.body;
}

const codeOf = (reply: MockReply) => (bodyOf(reply) as { error: { code: string } }).error.code;
const statusOf = (reply: MockReply) => (reply.kind === 'sse' ? 200 : reply.status);

function signedIn() {
  const clock = { now: 100_000 };
  const api = createMockApi(() => clock.now);
  api.handle(req('POST', '/session', { passcode: 'anything' }));
  return { api, clock };
}

describe('mock documents', () => {
  it('lists three read samples with drawn pages; the card from Sam has no summary voice', () => {
    const { api } = signedIn();
    const list = parseDocumentList(bodyOf(api.handle(req('GET', '/documents'))));

    expect(list?.map((doc) => [doc.title, doc.status])).toEqual([
      ['Water bill, October', 'ready'],
      ['Rates notice 2026', 'ready'],
      ['Card from Sam', 'ready'],
    ]);
    const sam = parseDocument(bodyOf(api.handle(req('GET', '/documents/doc_sam'))));
    expect(sam?.summary_audio_url).toBeNull();
    expect(sam?.pages[0]?.image_url).toMatch(/^data:image\/svg\+xml/);
    const water = parseDocument(bodyOf(api.handle(req('GET', '/documents/doc_water'))));
    expect(water?.summary_audio_url).toMatch(/^data:audio\/wav;base64,/);
  });

  it('uploads, reads on the clock, and refuses a question while the page is read', () => {
    const { api, clock } = signedIn();
    const created = parseCreateDocument(bodyOf(api.handle(req('POST', '/documents', { filename: 'a.jpg', content_type: 'image/jpeg', size_bytes: 1000 }))));
    const id = created?.document_id ?? '';

    expect(created?.upload_url).toBe(`/mock-s3/documents/${id}`);
    expect(parseCompleteDocument(bodyOf(api.handle(req('PUT', `/documents/${id}/source`))))?.status).toBe('reading');
    const asked = api.handle(req('POST', `/documents/${id}/ask`, { question: 'what is it?' }));
    expect(statusOf(asked)).toBe(400);
    expect(codeOf(asked)).toBe('VALIDATION_FAILED');

    clock.now += READ_MS;
    const doc = parseDocument(bodyOf(api.handle(req('GET', `/documents/${id}`))));
    expect(doc).toMatchObject({ status: 'ready', title: 'Letter from Harbour Bank' });
    expect(doc?.summary_audio_url).not.toBeNull();
  });

  it('refuses a file type or size the API does not take', () => {
    const { api } = signedIn();
    expect(codeOf(api.handle(req('POST', '/documents', { filename: 'a.mov', content_type: 'video/quicktime', size_bytes: 10 })))).toBe('VALIDATION_FAILED');
    expect(codeOf(api.handle(req('POST', '/documents', { filename: 'a.pdf', content_type: 'application/pdf', size_bytes: 21 * 1024 * 1024 })))).toBe('VALIDATION_FAILED');
  });

  it('answers a question with a voice, and speaks the text part by part', () => {
    const { api } = signedIn();
    const answer = parseDocumentAnswer(bodyOf(api.handle(req('POST', '/documents/doc_water/ask', { question: 'How do I pay?' }))));
    expect(answer?.answer).toMatch(/1300 555 019/);
    expect(answer?.audio_url).toMatch(/^data:audio\/wav/);

    const first = parseDocumentPart(bodyOf(api.handle(req('POST', '/documents/doc_rates/speak', { part: 0 }))));
    expect(first?.parts).toBeGreaterThan(1);
    expect(codeOf(api.handle(req('POST', '/documents/doc_rates/speak', { part: first?.parts ?? 0 })))).toBe('VALIDATION_FAILED');
  });

  it('renames and deletes', () => {
    const { api } = signedIn();
    expect(parseDocument(bodyOf(api.handle(req('PATCH', '/documents/doc_sam', { title: ' Birthday card ' }))))?.title).toBe('Birthday card');
    expect(api.handle(req('DELETE', '/documents/doc_sam'))).toEqual({ kind: 'empty', status: 204 });
    expect(codeOf(api.handle(req('GET', '/documents/doc_sam')))).toBe('NOT_FOUND');
  });

  it('reads a letter added with +, or named in the request; without one it asks for the letter', () => {
    const { api } = signedIn();
    const intent = (text: string, document_ids: string[] = []) =>
      parseIntent(bodyOf(api.handle(req('POST', '/intents', { text, clip_ids: [], document_ids }))));

    expect(intent('summarise this letter for me', ['doc_water'])).toMatchObject({ kind: 'read_document', document_ids: ['doc_water'], question: 'summarise this letter for me' });
    expect(intent('read my water bill')).toMatchObject({ kind: 'read_document', document_ids: ['doc_water'] });
    expect(intent('read my letter')?.choices).toEqual([{ label: 'Add the letter with +', text: 'read my letter' }]);
    expect(codeOf(api.handle(req('POST', '/intents', { text: 'read', clip_ids: [], document_ids: ['someone_else'] })))).toBe('FORBIDDEN');
  });
});

describe('splitParts', () => {
  it('cuts at sentence ends into parts of about 400 characters, and keeps a short text whole', () => {
    const sentence = 'This sentence is about fifty characters long, yes. ';
    const parts = splitParts(sentence.repeat(20));

    expect(parts.length).toBeGreaterThan(1);
    expect(parts.every((part) => part.length <= 400 && part.endsWith('.'))).toBe(true);
    expect(splitParts('One line.')).toEqual(['One line.']);
  });
});
