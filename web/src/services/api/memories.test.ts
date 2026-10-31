// Wire tests for the Memory Lane calls: the exact request (method, path, headers, body) first, then
// the parse; a missing key fails the parse.
import { describe, expect, it, vi } from 'vitest';
import { createApiClient } from './client';
import { parseMemory, parseMemoryList } from './parse-memories';

function answering(status: number, json: unknown) {
  const fetchFn = vi
    .fn<typeof fetch>()
    .mockResolvedValue(new Response(json === undefined ? null : JSON.stringify(json), { status, headers: { 'Content-Type': 'application/json' } }));
  const client = createApiClient({ baseUrl: '/api', timeoutMs: 5000, fetchFn });
  const sent = () => {
    const [url, init] = fetchFn.mock.calls[0] ?? [];
    return { url, method: init?.method, headers: init?.headers, body: init?.body };
  };
  return { client, sent };
}

const JSON_ONLY = { Accept: 'application/json' };
const JSON_BODY = { Accept: 'application/json', 'Content-Type': 'application/json' };

const SUMMARY = {
  id: 'mem_1',
  title: 'Kristoff at the party',
  subject_kind: 'person',
  subject_name: 'Kristoff',
  viewer_name: 'Eric',
  status: 'ready',
  step: null,
  moment_count: 1,
  fixed_count: 1,
  cover_url: null,
  created_at: '2026-10-31T09:00:00Z',
  error: null,
};

const MOMENT = {
  index: 0,
  clip_id: 'c1',
  clip_title: '60th birthday',
  recorded_at: '2026-10-12T10:00:00Z',
  start_s: 12.5,
  end_s: 19,
  proxy_url: 'https://s/p.mp4',
  thumb_url: null,
  people: [{ person_id: 'p_k', name: 'Kristoff', crop_url: null }],
  line: 'Kristoff speaks into a microphone.',
  prompt: 'What do you remember about his speech?',
  checked: true,
  fixed_note: 'Eric is not in that frame.',
};

describe('POST /memories', () => {
  it('sends every key, nulls for what is not chosen', async () => {
    const { client, sent } = answering(201, { memory_id: 'mem_1', status: 'making' });

    const created = await client.createMemory({ person_id: 'p_k', clip_id: null, viewer_id: null });

    expect(sent()).toEqual({ url: '/api/memories', method: 'POST', headers: JSON_BODY, body: '{"person_id":"p_k","clip_id":null,"viewer_id":null}' });
    expect(created).toEqual({ memory_id: 'mem_1', status: 'making' });
  });
});

describe('GET and DELETE /memories', () => {
  it('lists, gets and deletes by the encoded id', async () => {
    const list = answering(200, [SUMMARY]);
    await expect(list.client.listMemories()).resolves.toHaveLength(1);
    expect(list.sent()).toMatchObject({ url: '/api/memories', method: 'GET', headers: JSON_ONLY });

    const one = answering(200, { summary: SUMMARY, moments: [MOMENT] });
    await expect(one.client.getMemory('mem/1')).resolves.toMatchObject({ moments: [{ fixed_note: 'Eric is not in that frame.' }] });
    expect(one.sent()).toMatchObject({ url: '/api/memories/mem%2F1', method: 'GET' });

    const gone = answering(204, undefined);
    await expect(gone.client.deleteMemory('mem_1')).resolves.toBe(true);
    expect(gone.sent()).toMatchObject({ url: '/api/memories/mem_1', method: 'DELETE' });
  });

  it('refuses a row or moment with a missing key', () => {
    const noFixed: Partial<typeof SUMMARY> = { ...SUMMARY };
    delete noFixed.fixed_count;
    const noPrompt: Partial<typeof MOMENT> = { ...MOMENT };
    delete noPrompt.prompt;

    expect(parseMemoryList([noFixed])).toBeNull();
    expect(parseMemory({ summary: SUMMARY, moments: [noPrompt] })).toBeNull();
    expect(parseMemory({ summary: { ...SUMMARY, step: 'paint' }, moments: [] })).toBeNull();
  });
});
