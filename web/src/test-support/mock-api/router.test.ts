import { describe, expect, it } from 'vitest';
import { parseClipDetail } from '../../services/api/parse-clip-detail';
import { parseClipList } from '../../services/api/parse';
import { parseShortDetail } from '../../services/api/parse-shorts';
import { timelineV1 } from '../shorts';
import { createMockApi, MOCK_PART_SIZE, type MockReply, type MockRequest } from './router';

const req = (method: string, path: string, body: unknown = null, query = ''): MockRequest => ({
  method,
  path,
  query: new URLSearchParams(query),
  body,
});

function bodyOf(reply: MockReply): unknown {
  if (reply.kind !== 'json') throw new Error(`expected json, got ${reply.kind}`);
  return reply.body;
}

function signedIn(clock = { ms: 0 }) {
  const api = createMockApi(() => clock.ms);
  api.handle(req('POST', '/session', { passcode: 'anything' }));
  return { api, clock };
}

describe('mock api', () => {
  it('asks for the passcode first, accepts any passcode, and locks again on logout', () => {
    const api = createMockApi(() => 0);

    expect(api.handle(req('GET', '/clips'))).toMatchObject({ kind: 'json', status: 401 });
    expect(bodyOf(api.handle(req('POST', '/session', { passcode: 'x' })))).toEqual({ user_id: 'u_demo' });
    expect(api.handle(req('GET', '/clips'))).toMatchObject({ status: 200 });
    expect(api.handle(req('POST', '/session/logout'))).toEqual({ kind: 'empty', status: 204 });
    expect(api.handle(req('GET', '/clips'))).toMatchObject({ status: 401 });
  });

  it('serves a clip list the real parser accepts, with thumbnails on ready clips only', () => {
    const clips = parseClipList(bodyOf(signedIn().api.handle(req('GET', '/clips'))));

    expect(clips).not.toBeNull();
    expect(clips?.find((c) => c.status === 'ready')?.thumb_url).toMatch(/^data:image\/svg\+xml/);
    expect(clips?.find((c) => c.status === 'processing')?.thumb_url).toBeNull();
  });

  it('serves a full detail for a ready clip and an empty one while processing', () => {
    const { api } = signedIn();

    const ready = parseClipDetail(bodyOf(api.handle(req('GET', '/clips/clip_kitchen'))));
    const processing = parseClipDetail(bodyOf(api.handle(req('GET', '/clips/clip_office'))));

    expect(ready?.tracks[0]?.crop_url).toMatch(/^data:image/);
    expect(processing?.segments).toEqual([]);
    expect(api.handle(req('GET', '/clips/nope'))).toMatchObject({ status: 404 });
  });

  it('streams ingest steps for a processing clip on a loop', () => {
    const reply = signedIn().api.handle(req('GET', '/clips/clip_office/events'));

    expect(reply.kind).toBe('sse');
    if (reply.kind === 'sse') {
      expect(reply.events[1]).toEqual({ delayMs: 1500, data: { step: 'proxy', status: 'running' } });
      expect(reply.loopMs).toBe(reply.events.length * 1500);
    }
  });

  it('remembers a face name and a hidden flag', () => {
    const { api } = signedIn();

    expect(bodyOf(api.handle(req('PUT', '/tracks/tr_neighbour', { name: 'Ana' })))).toMatchObject({ person_name: 'Ana' });
    api.handle(req('PUT', '/tracks/tr_mirror', { hidden: true }));
    const detail = parseClipDetail(bodyOf(api.handle(req('GET', '/clips/clip_kitchen'))));

    expect(detail?.tracks.map((t) => [t.person_name, t.hidden])).toEqual([
      ['Sam', false],
      ['Ana', false],
      [null, true],
    ]);
  });

  it('filters people by prefix, ignoring case', () => {
    const people = bodyOf(signedIn().api.handle(req('GET', '/people', null, 'prefix=sa')));

    expect(people).toEqual([
      { person_id: 'p_sam', name: 'Sam' },
      { person_id: 'p_sara', name: 'Sara' },
    ]);
  });

  it('runs a whole upload: parts for the size, then the clip turns uploaded', () => {
    const { api } = signedIn();

    const created = bodyOf(api.handle(req('POST', '/uploads', { filename: 'run.mp4', size_bytes: MOCK_PART_SIZE * 2 + 1, content_type: 'video/mp4' }))) as {
      upload_id: string;
      clip_id: string;
      parts: { n: number; url: string }[];
    };
    expect(created.parts.map((p) => p.url)).toEqual(['/mock-s3/up_1/1', '/mock-s3/up_1/2', '/mock-s3/up_1/3']);

    api.handle(req('POST', `/uploads/${created.upload_id}/complete`, { parts: [] }));
    const clips = parseClipList(bodyOf(api.handle(req('GET', '/clips'))));
    expect(clips?.[0]).toMatchObject({ clip_id: created.clip_id, filename: 'run.mp4', status: 'uploaded' });
  });

  it('replays the agent after POST /shorts and appends a saved edit as a new version', () => {
    const { api, clock } = signedIn();

    expect(bodyOf(api.handle(req('POST', '/shorts', { prompt: 'p' })))).toEqual({ short_id: 'sh_fixture' });
    const early = parseShortDetail(bodyOf(api.handle(req('GET', '/shorts/sh_fixture'))));
    expect(early?.short.status).toBe('planning');

    clock.ms = 60_000;
    const done = parseShortDetail(bodyOf(api.handle(req('GET', '/shorts/sh_fixture'))));
    expect(done?.short.status).toBe('ready');
    expect(done?.segments[0]?.thumb_url).toMatch(/^data:image/);

    expect(bodyOf(api.handle(req('PUT', '/shorts/sh_fixture/timeline', { timeline: timelineV1() })))).toEqual({ version: 4 });
    const saved = parseShortDetail(bodyOf(api.handle(req('GET', '/shorts/sh_fixture'))));
    expect(saved?.versions.map((v) => v.n)).toEqual([1, 2, 3, 4]);
  });

  it('rejects a saved timeline that breaks the contract, and unknown routes', () => {
    const { api } = signedIn();

    expect(api.handle(req('PUT', '/shorts/sh_fixture/timeline', { timeline: { clips: [] } }))).toMatchObject({ status: 422 });
    expect(api.handle(req('DELETE', '/clips'))).toMatchObject({ status: 404 });
  });
});
