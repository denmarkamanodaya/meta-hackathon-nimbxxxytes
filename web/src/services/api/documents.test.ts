// Wire tests for the iRead document calls: the exact request (method, path, headers, body) first,
// then the parse of the recorded fixture.
import { describe, expect, it, vi } from 'vitest';
import documentsJson from '../../test-support/fixtures/documents.json';
import { ApiError, createApiClient } from './client';
import { parseDocument, parseDocumentAnswer, parseDocumentList, parseDocumentPart } from './parse-documents';

function answering(status: number, json: unknown) {
  const fetchFn = vi
    .fn<typeof fetch>()
    .mockResolvedValue(
      new Response(json === undefined ? null : JSON.stringify(json), { status, headers: { 'Content-Type': 'application/json' } }),
    );
  const client = createApiClient({ baseUrl: '/api', timeoutMs: 5000, fetchFn });
  const sent = () => {
    const [url, init] = fetchFn.mock.calls[0] ?? [];
    return { url, method: init?.method, headers: init?.headers, body: init?.body };
  };
  return { client, sent };
}

const water = documentsJson[0];
if (water === undefined) throw new Error('documents.json is empty');

const JSON_ONLY = { Accept: 'application/json' };
const JSON_BODY = { Accept: 'application/json', 'Content-Type': 'application/json' };

describe('POST /documents and /complete', () => {
  it('sends the file facts and reads the presigned PUT', async () => {
    const { client, sent } = answering(201, { document_id: 'd1', upload_url: 'https://r2/put' });

    const created = await client.createDocument({ filename: 'bill.jpg', content_type: 'image/jpeg', size_bytes: 1234 });

    expect(sent()).toEqual({
      url: '/api/documents',
      method: 'POST',
      headers: JSON_BODY,
      body: '{"filename":"bill.jpg","content_type":"image/jpeg","size_bytes":1234}',
    });
    expect(created).toEqual({ document_id: 'd1', upload_url: 'https://r2/put' });
  });

  it('PUTs the file itself to /source as the raw body with its type, the id escaped', async () => {
    const { client, sent } = answering(202, { document_id: 'd 1', status: 'reading' });
    const file = new Blob(['%PDF'], { type: 'application/pdf' });

    await expect(client.sendDocumentSource('d 1', file)).resolves.toEqual({ document_id: 'd 1', status: 'reading' });
    expect(sent()).toEqual({
      url: '/api/documents/d%201/source',
      method: 'PUT',
      headers: { Accept: 'application/json', 'Content-Type': 'application/pdf' },
      body: file,
    });
  });

  it('rejects with the server code when the file is refused', async () => {
    const { client } = answering(400, { error: { code: 'VALIDATION_FAILED', message: 'the file is larger than 20 MB' } });

    await expect(client.sendDocumentSource('d1', new Blob(['x'], { type: 'image/jpeg' }))).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
  });
});

describe('GET, PATCH and DELETE /documents', () => {
  it('lists and reads the recorded documents', async () => {
    const { client, sent } = answering(200, documentsJson);

    const list = await client.listDocuments();

    expect(sent()).toMatchObject({ url: '/api/documents', method: 'GET', body: undefined });
    expect(list.map((doc) => [doc.id, doc.kind, doc.page_count])).toEqual([
      ['doc_water', 'bill', 1],
      ['doc_rates', 'notice', 2],
      ['doc_sam', 'letter', 1],
    ]);
    expect(parseDocument(documentsJson[1])?.pages.map((page) => page.n)).toEqual([1, 2]);
    expect(parseDocument(documentsJson[2])?.summary_audio_url).toBeNull();
  });

  it('fails a row or a document that leaves out a contract key', () => {
    const noThumb: Partial<typeof water> = { ...water };
    delete noThumb.thumb_url;
    const noVoice: Partial<typeof water> = { ...water };
    delete noVoice.summary_audio_url;

    expect(parseDocumentList([noThumb])).toBeNull();
    expect(parseDocument(noVoice)).toBeNull();
    expect(parseDocument({ ...water, kind: 'poem' })).toBeNull();
    expect(parseDocument({ ...water, status: 'done' })).toBeNull();
  });

  it('renames with the title and deletes with no body', async () => {
    const renamed = answering(200, water);
    await renamed.client.renameDocument('doc_water', 'Water');
    expect(renamed.sent()).toEqual({ url: '/api/documents/doc_water', method: 'PATCH', headers: JSON_BODY, body: '{"title":"Water"}' });

    const deleted = answering(204, undefined);
    await expect(deleted.client.deleteDocument('doc_water')).resolves.toBe(true);
    expect(deleted.sent()).toEqual({ url: '/api/documents/doc_water', method: 'DELETE', headers: JSON_ONLY, body: undefined });
  });
});

describe('POST /documents/{id}/ask and /speak', () => {
  it('asks with the question and reads the answer, its voice nullable', async () => {
    const { client, sent } = answering(200, { question: 'how do I pay?', answer: 'By phone.', audio_url: null });

    await expect(client.askDocument('doc_water', 'how do I pay?')).resolves.toEqual({ question: 'how do I pay?', answer: 'By phone.', audio_url: null });
    expect(sent()).toEqual({ url: '/api/documents/doc_water/ask', method: 'POST', headers: JSON_BODY, body: '{"question":"how do I pay?"}' });
    expect(parseDocumentAnswer({ question: 'q', answer: 'a' })).toBeNull();
  });

  it('rejects with VALIDATION_FAILED while the page is still read', async () => {
    const { client } = answering(400, { error: { code: 'VALIDATION_FAILED', message: 'still reading' } });

    const error = await client.askDocument('d', 'q').catch((thrown: unknown) => thrown);

    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).code).toBe('VALIDATION_FAILED');
  });

  it('speaks one part and refuses a part outside the text', async () => {
    const { client, sent } = answering(200, { part: 1, parts: 3, text: 'Part two.', audio_url: 'https://m/p1.wav' });

    await expect(client.speakDocument('doc_rates', 1)).resolves.toEqual({ part: 1, parts: 3, text: 'Part two.', audio_url: 'https://m/p1.wav' });
    expect(sent()).toEqual({ url: '/api/documents/doc_rates/speak', method: 'POST', headers: JSON_BODY, body: '{"part":1}' });
    expect(parseDocumentPart({ part: 3, parts: 3, text: '', audio_url: null })).toBeNull();
    expect(parseDocumentPart({ part: 0, parts: 1, text: 'x', audio_url: null })).toEqual({ part: 0, parts: 1, text: 'x', audio_url: null });
  });
});
