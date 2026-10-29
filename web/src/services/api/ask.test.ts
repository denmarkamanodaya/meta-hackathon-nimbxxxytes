import { describe, expect, it, vi } from 'vitest';
import { ApiError, createApiClient } from './client';
import { parseIntent } from './parse-ask';
import type { IntentAnswer } from './types';

const jsonResponse = (status: number, body: unknown): Response =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

const shortIntent: IntentAnswer = {
  kind: 'make_short',
  title: 'Thai trip sunsets',
  query: 'sunsets',
  source: 'project',
  project_id: 'prj_1',
  new_project_name: null,
  clip_ids: [],
  target_s: 30,
  aspect: '4:5',
  choices: [],
  document_ids: [],
  question: null,
};

describe('transcribe', () => {
  it('POSTs the voice note as the raw body with its bare media type', async () => {
    const fetchFn = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse(200, { text: 'make a short' }));
    const client = createApiClient({ baseUrl: '/api', timeoutMs: 5000, fetchFn });
    const audio = new Blob(['RIFF'], { type: 'audio/webm;codecs=opus' });

    await expect(client.transcribe(audio)).resolves.toEqual({ text: 'make a short' });

    const [url, init] = fetchFn.mock.calls[0] ?? [];
    expect(url).toBe('/api/transcribe');
    expect(init?.method).toBe('POST');
    expect(init?.body).toBe(audio);
    expect(init?.headers).toEqual({ Accept: 'application/json', 'Content-Type': 'audio/webm' });
  });

  it('rejects with the server code when the audio is refused', async () => {
    const fetchFn = vi
      .fn<typeof fetch>()
      .mockResolvedValue(jsonResponse(400, { error: { code: 'VALIDATION_FAILED', message: 'empty body' } }));
    const client = createApiClient({ baseUrl: '/api', timeoutMs: 5000, fetchFn });

    const error = await client.transcribe(new Blob([], { type: 'audio/mp4' })).catch((thrown: unknown) => thrown);

    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).code).toBe('VALIDATION_FAILED');
  });
});

describe('readIntent', () => {
  it('POSTs the text and the added clips as JSON and resolves the parsed intent', async () => {
    const fetchFn = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse(200, shortIntent));
    const client = createApiClient({ baseUrl: '/api', timeoutMs: 5000, fetchFn });

    await expect(client.readIntent({ text: 'sunsets short', clip_ids: ['c1'], document_ids: ['d1'] })).resolves.toEqual(shortIntent);

    const [url, init] = fetchFn.mock.calls[0] ?? [];
    expect(url).toBe('/api/intents');
    expect(init?.method).toBe('POST');
    expect(init?.body).toBe('{"text":"sunsets short","clip_ids":["c1"],"document_ids":["d1"]}');
    expect(init?.headers).toEqual({ Accept: 'application/json', 'Content-Type': 'application/json' });
  });

  it('reports a body without every contract key as BAD_RESPONSE', async () => {
    const partial: Partial<IntentAnswer> = { ...shortIntent };
    delete partial.choices;
    const fetchFn = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse(200, partial));
    const client = createApiClient({ baseUrl: '/api', timeoutMs: 5000, fetchFn });

    const error = await client.readIntent({ text: 'x', clip_ids: [], document_ids: [] }).catch((thrown: unknown) => thrown);

    expect((error as ApiError).code).toBe('BAD_RESPONSE');
  });
});

describe('parseIntent', () => {
  it('reads an unclear answer with its choices', () => {
    const body = {
      ...shortIntent,
      kind: 'unclear',
      source: null,
      project_id: null,
      target_s: null,
      aspect: null,
      choices: [{ label: 'Make a short from 60th Birthday', text: 'make a 30 second short from 60th Birthday' }],
    };

    expect(parseIntent(body)?.choices).toEqual(body.choices);
  });

  it('refuses an unknown kind, source or frame', () => {
    expect(parseIntent({ ...shortIntent, kind: 'dance' })).toBeNull();
    expect(parseIntent({ ...shortIntent, source: 'camera' })).toBeNull();
    expect(parseIntent({ ...shortIntent, aspect: '16:9' })).toBeNull();
    expect(parseIntent({ ...shortIntent, choices: [{ label: 'x' }] })).toBeNull();
  });

  it('reads a read_document answer with its document and question', () => {
    const body = { ...shortIntent, kind: 'read_document', source: null, project_id: null, target_s: null, aspect: null, query: null, document_ids: ['d1'], question: 'how do I pay?' };

    expect(parseIntent(body)).toMatchObject({ kind: 'read_document', document_ids: ['d1'], question: 'how do I pay?' });
  });

  it('refuses an answer without document_ids or question (both always present)', () => {
    const noDocs: Partial<IntentAnswer> = { ...shortIntent };
    delete noDocs.document_ids;
    const noQuestion: Partial<IntentAnswer> = { ...shortIntent };
    delete noQuestion.question;

    expect(parseIntent(noDocs)).toBeNull();
    expect(parseIntent(noQuestion)).toBeNull();
  });
});
