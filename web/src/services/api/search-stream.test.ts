import { describe, expect, it, vi } from 'vitest';
import type { ApiTransport } from '../../core/ports/api-transport';
import { ApiError, createApiClient } from './client';
import type { SearchResponse, SearchStage } from './types';

const response = (segmentIds: string[], extra: Partial<SearchResponse> = {}): SearchResponse => ({
  rewritten: {
    keywords: ['beach'],
    filters: { people: [], speakers: [], place: null, from: null, to: null, min_quality: null },
  },
  results: segmentIds.map((id) => ({
    kind: 'moment',
    photo_id: null,
    segment_id: id,
    clip_id: 'c1',
    start_s: 1,
    end_s: 4,
    thumb_url: null,
    reason: null,
    score: 0.5,
    clip_filename: 'beach.mp4',
    clip_title: 'Beach walk',
    recorded_at: null,
    faces: [],
  })),
  reranked: false,
  took_ms: 180,
  cached: false,
  cost_usd: 0,
  ...extra,
});

const local = response(['s1', 's2']);
const ranked = response(['s2', 's1'], { reranked: true, took_ms: 3900, cost_usd: 0.0031 });

/** A streamed `text/event-stream` body, split into the given chunks. */
function sseResponse(chunks: string[], status = 200): Response {
  const encoder = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
      controller.close();
    },
  });
  return new Response(body, { status, headers: { 'Content-Type': 'text/event-stream' } });
}

const frame = (event: string, data: unknown) => `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

function run(fetchFn: typeof fetch, onUnauthorized = vi.fn()) {
  const client = createApiClient({ baseUrl: '/api', timeoutMs: 5000, fetchFn, onUnauthorized });
  const stages: SearchStage[] = [];
  return {
    stages,
    done: (signal?: AbortSignal) =>
      client.searchStream('Sam at the beach', (stage) => stages.push(stage), signal),
  };
}

describe('searchStream over the fetch transport', () => {
  it('POSTs the query as JSON to /search/stream asking for an event stream', async () => {
    const fetchFn = vi
      .fn<typeof fetch>()
      .mockResolvedValue(sseResponse([frame('local', local), frame('ranked', ranked), 'event: done\ndata: {}\n\n']));

    await run(fetchFn).done();

    const [url, init] = fetchFn.mock.calls[0] ?? [];
    expect(url).toBe('/api/search/stream');
    expect(init).toMatchObject({
      method: 'POST',
      credentials: 'include',
      headers: { Accept: 'text/event-stream', 'Content-Type': 'application/json' },
      body: '{"query":"Sam at the beach"}',
    });
  });

  it('delivers local, then ranked, even when frames split across chunks', async () => {
    const wire = frame('local', local) + ': keep-alive\n\n' + frame('ranked', ranked) + 'event: done\ndata: {}\n\n';
    const fetchFn = vi.fn<typeof fetch>().mockResolvedValue(sseResponse([wire.slice(0, 37), wire.slice(37, 900), wire.slice(900)]));
    const { stages, done } = run(fetchFn);

    await done();

    expect(stages).toEqual([
      { stage: 'local', response: local },
      { stage: 'ranked', response: ranked },
    ]);
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it('falls back to POST /search when the server has no stream endpoint (404)', async () => {
    const fetchFn = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response('', { status: 404 }))
      .mockResolvedValueOnce(json(200, ranked));
    const { stages, done } = run(fetchFn);

    await done();

    expect(fetchFn.mock.calls.map(([url, init]) => [url, init?.method, init?.body])).toEqual([
      ['/api/search/stream', 'POST', '{"query":"Sam at the beach"}'],
      ['/api/search', 'POST', '{"query":"Sam at the beach"}'],
    ]);
    expect(stages).toEqual([{ stage: 'ranked', response: ranked }]);
  });

  it('falls back when the stream closes without a valid stage', async () => {
    const fetchFn = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(sseResponse(['event: local\ndata: {"oops":1}\n\n', 'event: done\ndata: {}\n\n']))
      .mockResolvedValueOnce(json(200, ranked));
    const { stages, done } = run(fetchFn);

    await done();

    expect(stages).toEqual([{ stage: 'ranked', response: ranked }]);
  });

  it('rejects on 401 after calling onUnauthorized, without the fallback', async () => {
    const onUnauthorized = vi.fn();
    const fetchFn = vi
      .fn<typeof fetch>()
      .mockResolvedValue(json(401, { error: { code: 'UNAUTHORIZED', message: 'Sign in' } }));

    await expect(run(fetchFn, onUnauthorized).done()).rejects.toMatchObject({ code: 'UNAUTHORIZED', status: 401 });
    expect(onUnauthorized).toHaveBeenCalledTimes(1);
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it('falls back when the route exists only for another method (405)', async () => {
    const fetchFn = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response('', { status: 405 }))
      .mockResolvedValueOnce(json(200, ranked));
    const { stages, done } = run(fetchFn);

    await done();

    expect(stages).toEqual([{ stage: 'ranked', response: ranked }]);
  });

  it('shows a refusal of the search itself (400) without a second request', async () => {
    const fetchFn = vi
      .fn<typeof fetch>()
      .mockResolvedValue(json(400, { error: { code: 'VALIDATION_FAILED', message: 'Empty query' } }));

    await expect(run(fetchFn).done()).rejects.toMatchObject({ code: 'VALIDATION_FAILED', status: 400 });
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it('keeps the local stage when the server sends error instead of ranked', async () => {
    const envelope = { error: { code: 'MODEL_UNAVAILABLE', message: 'Spark down' } };
    const fetchFn = vi
      .fn<typeof fetch>()
      .mockResolvedValue(sseResponse([frame('local', local), frame('error', envelope), 'event: done\ndata: {}\n\n']));
    const { stages, done } = run(fetchFn);

    await done();

    expect(stages).toEqual([{ stage: 'local', response: local }]);
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it('never falls back when the caller aborted', async () => {
    const controller = new AbortController();
    const reason = new DOMException('gone', 'AbortError');
    const fetchFn = vi.fn<typeof fetch>().mockImplementation(() => {
      controller.abort(reason);
      return Promise.reject(reason);
    });

    await expect(run(fetchFn).done(controller.signal)).rejects.toBe(reason);
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });
});

describe('searchStream over any transport', () => {
  const transport = (streamRequest: ApiTransport['streamRequest'], send = vi.fn<ApiTransport['send']>()): ApiTransport => ({
    send,
    streamRequest,
    openStream: () => () => undefined,
  });

  it('keeps the local stage and rejects, without a paid second search, when the stream breaks after it', async () => {
    const send = vi.fn<ApiTransport['send']>();
    const broken = new ApiError('NETWORK_ERROR', 'Could not reach the server', null);
    const client = createApiClient({
      baseUrl: '/api',
      timeoutMs: 5000,
      transport: transport((_request, onEvent) => {
        onEvent({ event: 'local', data: JSON.stringify(local) });
        return Promise.reject(broken);
      }, send),
    });
    const stages: SearchStage[] = [];

    await expect(client.searchStream('beach', (stage) => stages.push(stage))).rejects.toBe(broken);
    expect(stages).toEqual([{ stage: 'local', response: local }]);
    expect(send).not.toHaveBeenCalled();
  });

  it('falls back to the plain request when the native stream fails before any stage', async () => {
    const send = vi
      .fn<ApiTransport['send']>()
      .mockResolvedValue({ status: 200, body: JSON.stringify(ranked), contentType: 'application/json' });
    const client = createApiClient({
      baseUrl: '/api',
      timeoutMs: 5000,
      transport: transport(
        () => Promise.reject(new ApiError('DESKTOP_FAILED', 'server answered 405 Method Not Allowed', null)),
        send,
      ),
    });
    const stages: SearchStage[] = [];

    await client.searchStream('beach', (stage) => stages.push(stage));

    expect(send).toHaveBeenCalledWith(
      expect.objectContaining({ method: 'POST', path: '/search', body: '{"query":"beach"}' }),
    );
    expect(stages).toEqual([{ stage: 'ranked', response: ranked }]);
  });
});
