// Wire tests for the iListen calls: the exact request (method, path, headers, body) first, then the
// parse of the fixture; a missing key fails the parse.
import { describe, expect, it, vi } from 'vitest';
import listensJson from '../../test-support/fixtures/listens.json';
import { createApiClient, LISTEN_SOURCE_TIMEOUT_MS } from './client';
import { parseListen, parseListenList, parseListenStarted } from './parse-listens';

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

const meeting = listensJson.find((each) => each.id === 'lis_meeting');
const JSON_ONLY = { Accept: 'application/json' };
const JSON_BODY = { Accept: 'application/json', 'Content-Type': 'application/json' };

describe('POST /listens, PUT /source and /complete', () => {
  it('sends a file with every key, nulls for the clip', async () => {
    const { client, sent } = answering(201, { listen_id: 'l1', status: 'uploading' });

    const created = await client.createListen({ filename: 'mix.wav', content_type: 'audio/wav', size_bytes: 1234, clip_id: null, target: 'en' });

    expect(sent()).toEqual({
      url: '/api/listens',
      method: 'POST',
      headers: JSON_BODY,
      body: '{"filename":"mix.wav","content_type":"audio/wav","size_bytes":1234,"clip_id":null,"target":"en"}',
    });
    expect(created).toEqual({ listen_id: 'l1', status: 'uploading' });
  });

  it('sends a clip with nulls for the file', async () => {
    const { client, sent } = answering(201, { listen_id: 'l2', status: 'listening' });

    await client.createListen({ filename: null, content_type: null, size_bytes: null, clip_id: 'c1', target: 'zh' });

    expect(sent().body).toBe('{"filename":null,"content_type":null,"size_bytes":null,"clip_id":"c1","target":"zh"}');
  });

  it('PUTs the raw file with its type, then POSTs complete with no body', async () => {
    const put = answering(202, { listen_id: 'l1', status: 'listening' });
    const file = new File(['RIFF'], 'mix.wav', { type: 'audio/wav' });

    await put.client.sendListenSource('l 1', file);

    expect(put.sent()).toEqual({ url: '/api/listens/l%201/source', method: 'PUT', headers: { Accept: 'application/json', 'Content-Type': 'audio/wav' }, body: file });

    const done = answering(202, { listen_id: 'l1', status: 'listening' });
    expect(await done.client.completeListen('l1')).toEqual({ listen_id: 'l1', status: 'listening' });
    expect(done.sent()).toEqual({ url: '/api/listens/l1/complete', method: 'POST', headers: JSON_ONLY, body: undefined });
  });

  it('gives a 300 MB file minutes to arrive', () => {
    expect(LISTEN_SOURCE_TIMEOUT_MS).toBeGreaterThanOrEqual(10 * 60_000);
  });
});

describe('GET, PATCH, DELETE and /language', () => {
  it('reads the list and one listen from the fixtures', async () => {
    const list = answering(200, listensJson);
    expect((await list.client.listListens()).map((each) => each.id)).toEqual(listensJson.map((each) => each.id));
    expect(list.sent()).toMatchObject({ url: '/api/listens', method: 'GET' });

    const one = answering(200, meeting);
    const listen = await one.client.getListen('lis_meeting');
    expect(listen.turns[1]?.fixed_in).toBe(2);
    expect(listen.versions.map((each) => each.confidence)).toEqual([75, 100]);
  });

  it('renames with the title, changes the language with the target, deletes with no body', async () => {
    const rename = answering(200, meeting);
    await rename.client.renameListen('lis_meeting', 'Meeting');
    expect(rename.sent()).toEqual({ url: '/api/listens/lis_meeting', method: 'PATCH', headers: JSON_BODY, body: '{"title":"Meeting"}' });

    const language = answering(200, meeting);
    await language.client.changeListenLanguage('lis_meeting', 'ja');
    expect(language.sent()).toEqual({ url: '/api/listens/lis_meeting/language', method: 'POST', headers: JSON_BODY, body: '{"target":"ja"}' });

    const remove = answering(204, undefined);
    expect(await remove.client.deleteListen('lis_meeting')).toBe(true);
    expect(remove.sent()).toEqual({ url: '/api/listens/lis_meeting', method: 'DELETE', headers: JSON_ONLY, body: undefined });
  });
});

describe('parse-listens', () => {
  it('parses every fixture', () => {
    expect(parseListenList(listensJson)).not.toBeNull();
    for (const each of listensJson) expect(parseListen(each)).not.toBeNull();
  });

  it('fails on a missing key, a bad step or a score over 100', () => {
    expect(parseListen({ ...meeting, versions: undefined })).toBeNull();
    expect(parseListen({ ...meeting, step: 'dance' })).toBeNull();
    expect(parseListen({ ...meeting, confidence: 101 })).toBeNull();
    expect(parseListen({ ...meeting, turns: [{ ...meeting?.turns[0], fixed_in: 0 }] })).toBeNull();
    expect(parseListenStarted({ listen_id: 'l1' })).toBeNull();
  });
});
