import { describe, expect, it } from 'vitest';
import { parseClipDetail } from '../../services/api/parse-clip-detail';
import { parseClipList } from '../../services/api/parse';
import { parsePeopleOverview, parseShortList, parseStorage } from '../../services/api/parse-overview';
import { parseSearch } from '../../services/api/parse-search';
import { parseShortDetail } from '../../services/api/parse-shorts';
import { readPlayerProps } from '../../hooks/usePlayerProps';
import { timelineV1 } from '../shorts';
import { createMockApi, MOCK_FIXTURE_SIZE, MOCK_PART_SIZE, type MockReply, type MockRequest } from './router';

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
      const steps = reply.events.map((e) => (e.data as { step: string }).step);
      expect(steps.slice(steps.indexOf('describe'), steps.indexOf('describe') + 3)).toEqual(['describe', 'title', 'faces']);
    }
  });

  it('streams the search as local, ranked, done and then closes', () => {
    const reply = signedIn().api.handle(req('POST', '/search/stream', { query: 'Coffee  Morning' }));

    expect(reply.kind).toBe('sse');
    if (reply.kind === 'sse') {
      expect(reply.events.map((e) => e.event)).toEqual(['local', 'ranked', 'done']);
      const local = parseSearch(reply.events[0]?.data);
      const ranked = parseSearch(reply.events[1]?.data);
      expect(local?.rewritten.keywords).toEqual(['coffee', 'morning']);
      expect(local?.results.every((r) => r.reason === null)).toBe(true);
      expect(local?.results.length).toBe((ranked?.results.length ?? 0) - 1);
      expect(reply.closeMs).toBeGreaterThan(reply.events[2]?.delayMs ?? Infinity);
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

  it('serves storage, search faces with crops, and the shorts list the real parsers accept', () => {
    const { api } = signedIn();

    const storage = parseStorage(bodyOf(api.handle(req('GET', '/storage'))));
    const search = parseSearch(bodyOf(api.handle(req('POST', '/search', { query: 'coffee' }))));
    const shorts = parseShortList(bodyOf(api.handle(req('GET', '/shorts'))));

    expect(storage?.clip_count).toBe(parseClipList(bodyOf(api.handle(req('GET', '/clips'))))?.length);
    expect(search?.results.flatMap((r) => r.faces).every((f) => f.crop_url?.startsWith('data:image/svg+xml'))).toBe(true);
    expect(shorts?.map((s) => s.short_id)).toContain('sh_fixture');
  });

  it('moves a face between the queue, the named and the hidden lists of the people overview', () => {
    const { api } = signedIn();
    const overview = () => parsePeopleOverview(bodyOf(api.handle(req('GET', '/people/overview'))));
    const before = overview();

    api.handle(req('PUT', '/tracks/tr_neighbour', { hidden: true }));
    const hidden = overview();
    api.handle(req('PUT', '/tracks/tr_bus_driver', { hidden: false }));
    const unhidden = overview();

    expect(before?.unnamed.map((f) => f.track_id)).toContain('tr_neighbour');
    expect(hidden?.unnamed.map((f) => f.track_id)).not.toContain('tr_neighbour');
    expect(hidden?.hidden.map((f) => f.track_id)).toContain('tr_neighbour');
    expect(hidden?.hidden_count).toBe((before?.hidden_count ?? 0) + 1);
    expect(unhidden?.hidden.map((f) => f.track_id)).not.toContain('tr_bus_driver');
    expect(unhidden?.unnamed.map((f) => f.track_id)).toContain('tr_bus_driver');
  });

  it('flags a picked file with the same name and size as a library clip, then deletes the copy', () => {
    const { api } = signedIn();
    const check = (filename: string, size_bytes: number) => bodyOf(api.handle(req('POST', '/uploads/check', { filename, size_bytes })));

    expect(check('morning-coffee.mp4', MOCK_FIXTURE_SIZE)).toEqual({ duplicate_of: { clip_id: 'clip_kitchen', title: 'Morning coffee pour' } });
    expect(check('morning-coffee.mp4', MOCK_FIXTURE_SIZE + 1)).toEqual({ duplicate_of: null });
    expect(api.handle(req('DELETE', '/clips/clip_kitchen_copy'))).toEqual({ kind: 'empty', status: 204 });
    expect(parseClipList(bodyOf(api.handle(req('GET', '/clips'))))?.some((c) => c.clip_id === 'clip_kitchen_copy')).toBe(false);
    expect(api.handle(req('DELETE', '/clips/clip_kitchen_copy'))).toMatchObject({ status: 404 });
  });

  it('sends face groups only while matching is on, and names a whole group in one call', () => {
    const { api } = signedIn();
    const overview = () => parsePeopleOverview(bodyOf(api.handle(req('GET', '/people/overview'))));

    expect(overview()?.unnamed.every((f) => f.group_id === null && f.suggested === null)).toBe(true);
    expect(bodyOf(api.handle(req('PUT', '/settings', { face_matching: true })))).toEqual({ face_matching: true });
    expect(overview()?.unnamed.filter((f) => f.group_id === 'g_dog')).toHaveLength(2);

    expect(api.handle(req('POST', '/tracks/name', { track_ids: ['tr_dog_walk', 'tr_dog_park'], name: 'Biscuit' }))).toEqual({ kind: 'empty', status: 204 });
    const after = overview();
    expect(after?.unnamed.some((f) => f.group_id === 'g_dog')).toBe(false);
    expect(after?.people.map((p) => p.name)).toContain('Biscuit');
    expect(api.handle(req('PUT', '/settings', { face_matching: 'yes' }))).toMatchObject({ status: 400 });
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

    expect(api.handle(req('PUT', '/shorts/sh_fixture/timeline', { timeline: { clips: [] } }))).toMatchObject({ status: 400, body: { error: { code: 'VALIDATION_FAILED' } } });
    expect(api.handle(req('DELETE', '/clips'))).toMatchObject({ status: 404 });
  });

  it('gives every version Player props laid out by its own timeline', () => {
    const short = parseShortDetail(bodyOf(signedIn().api.handle(req('GET', '/shorts/sh_fixture'))));

    for (const version of short?.versions ?? []) {
      expect(readPlayerProps(version.composition_props)?.clips.map((c) => c.segment_id)).toEqual(
        version.timeline.clips.map((c) => c.segment_id),
      );
    }
    expect(readPlayerProps(short?.versions[0]?.composition_props)?.clips[0]?.captions.length).toBeGreaterThan(0);
  });
});

