import { describe, expect, it, vi } from 'vitest';
import { parseEnv } from '../../app/env';
import { ApiError, createApiClient } from './client';

const jsonResponse = (status: number, body: unknown): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });

async function captureError(promise: Promise<unknown>): Promise<ApiError> {
  try {
    await promise;
  } catch (thrown) {
    if (thrown instanceof ApiError) return thrown;
    throw thrown;
  }
  throw new Error('expected the call to reject');
}

describe('createApiClient', () => {
  it('sends GET ${VITE_API_BASE}/health with the session cookie and a JSON accept header', async () => {
    const fetchFn = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse(200, { ok: true }));
    const { apiBase } = parseEnv({ VITE_API_BASE: '/api/' });
    const client = createApiClient({ baseUrl: apiBase, timeoutMs: 5000, fetchFn });

    await client.getHealth();

    expect(fetchFn).toHaveBeenCalledTimes(1);
    const [url, init] = fetchFn.mock.calls[0] ?? [];
    expect(url).toBe('/api/health');
    expect(init?.method).toBe('GET');
    expect(init?.credentials).toBe('include');
    expect(init?.headers).toEqual({ Accept: 'application/json' });
    expect(init?.signal).toBeInstanceOf(AbortSignal);
  });

  it('resolves the parsed health body', async () => {
    const fetchFn = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse(200, { ok: true }));
    const client = createApiClient({ baseUrl: '/api', timeoutMs: 5000, fetchFn });

    await expect(client.getHealth()).resolves.toEqual({ ok: true });
  });

  it('maps an error envelope to an ApiError carrying the server code, message and status', async () => {
    const body = { error: { code: 'FORBIDDEN', message: 'Not your clip' } };
    const fetchFn = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse(403, body));
    const client = createApiClient({ baseUrl: '/api', timeoutMs: 5000, fetchFn });

    const error = await captureError(client.getHealth());

    expect(error.code).toBe('FORBIDDEN');
    expect(error.message).toBe('Not your clip');
    expect(error.status).toBe(403);
  });

  it('reports an unknown server code as BAD_RESPONSE and keeps the raw code in the message', async () => {
    const body = { error: { code: 'BRAND_NEW', message: 'later phase' } };
    const fetchFn = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse(409, body));
    const client = createApiClient({ baseUrl: '/api', timeoutMs: 5000, fetchFn });

    const error = await captureError(client.getHealth());

    expect(error.code).toBe('BAD_RESPONSE');
    expect(error.message).toContain('BRAND_NEW');
    expect(error.status).toBe(409);
  });

  it('reports a non-JSON error body as BAD_RESPONSE with the HTTP status', async () => {
    const html = new Response('<html>502 Bad Gateway</html>', {
      status: 502,
      headers: { 'Content-Type': 'text/html' },
    });
    const fetchFn = vi.fn<typeof fetch>().mockResolvedValue(html);
    const client = createApiClient({ baseUrl: '/api', timeoutMs: 5000, fetchFn });

    const error = await captureError(client.getHealth());

    expect(error.code).toBe('BAD_RESPONSE');
    expect(error.status).toBe(502);
  });

  it('reports a 200 with the wrong shape as BAD_RESPONSE', async () => {
    const fetchFn = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse(200, { ok: 'yes' }));
    const client = createApiClient({ baseUrl: '/api', timeoutMs: 5000, fetchFn });

    const error = await captureError(client.getHealth());

    expect(error.code).toBe('BAD_RESPONSE');
  });

  it('maps a network failure to NETWORK_ERROR with no status', async () => {
    const fetchFn = vi.fn<typeof fetch>().mockRejectedValue(new TypeError('Failed to fetch'));
    const client = createApiClient({ baseUrl: '/api', timeoutMs: 5000, fetchFn });

    const error = await captureError(client.getHealth());

    expect(error.code).toBe('NETWORK_ERROR');
    expect(error.status).toBeNull();
  });

  it('maps a timeout to TIMEOUT', async () => {
    const fetchFn = vi
      .fn<typeof fetch>()
      .mockRejectedValue(new DOMException('signal timed out', 'TimeoutError'));
    const client = createApiClient({ baseUrl: '/api', timeoutMs: 5000, fetchFn });

    const error = await captureError(client.getHealth());

    expect(error.code).toBe('TIMEOUT');
  });

  it('rethrows the abort unchanged when the caller cancels', async () => {
    const controller = new AbortController();
    const abort = new DOMException('aborted', 'AbortError');
    const fetchFn = vi.fn<typeof fetch>().mockImplementation(() => {
      controller.abort();
      return Promise.reject(abort);
    });
    const client = createApiClient({ baseUrl: '/api', timeoutMs: 5000, fetchFn });

    await expect(client.getHealth(controller.signal)).rejects.toBe(abort);
  });

  it('fires onUnauthorized on a 401 and still rejects with the typed code', async () => {
    const body = { error: { code: 'UNAUTHORIZED', message: 'no session' } };
    const fetchFn = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse(401, body));
    const onUnauthorized = vi.fn();
    const client = createApiClient({ baseUrl: '/api', timeoutMs: 5000, fetchFn, onUnauthorized });

    const error = await captureError(client.listClips());

    expect(onUnauthorized).toHaveBeenCalledTimes(1);
    expect(error.code).toBe('UNAUTHORIZED');
  });
});

/** Arranges one JSON answer and returns the client plus a reader for the request sent. */
function clientAnswering(status: number, body: unknown) {
  const fetchFn = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse(status, body));
  const client = createApiClient({ baseUrl: '/api', timeoutMs: 5000, fetchFn });
  const sent = () => {
    const [url, init] = fetchFn.mock.calls[0] ?? [];
    return { url, method: init?.method, headers: init?.headers, body: init?.body, credentials: init?.credentials };
  };
  return { client, sent };
}

describe('Phase 1 endpoints: outgoing requests', () => {
  it('POST /session sends the passcode as JSON', async () => {
    const { client, sent } = clientAnswering(200, { user_id: 'u1' });

    await expect(client.createSession('hunter2')).resolves.toEqual({ user_id: 'u1' });

    expect(sent()).toEqual({
      url: '/api/session',
      method: 'POST',
      headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
      body: '{"passcode":"hunter2"}',
      credentials: 'include',
    });
  });

  it('POST /uploads sends filename, size_bytes and content_type and parses every part URL', async () => {
    const answer = { upload_id: 'up1', clip_id: 'c1', part_size: 8388608, parts: [{ n: 1, url: 'https://s3/1' }] };
    const { client, sent } = clientAnswering(200, answer);

    const created = await client.createUpload({ filename: 'a.mp4', size_bytes: 42, content_type: 'video/mp4' });

    expect(sent().url).toBe('/api/uploads');
    expect(sent().body).toBe('{"filename":"a.mp4","size_bytes":42,"content_type":"video/mp4"}');
    expect(created).toEqual(answer);
  });

  it('POST /uploads/{id}/parts sends part_numbers and escapes the id', async () => {
    const { client, sent } = clientAnswering(200, { parts: [{ n: 2, url: 'https://s3/2' }] });

    await client.presignParts('up/1', [2, 5]);

    expect(sent().url).toBe('/api/uploads/up%2F1/parts');
    expect(sent().body).toBe('{"part_numbers":[2,5]}');
  });

  it('POST /uploads/{id}/complete sends parts with n and etag, quotes kept', async () => {
    const { client, sent } = clientAnswering(200, { clip_id: 'c1', status: 'uploaded' });

    await client.completeUpload('up1', [{ n: 1, etag: '"abc"' }]);

    expect(sent().url).toBe('/api/uploads/up1/complete');
    expect(sent().body).toBe('{"parts":[{"n":1,"etag":"\\"abc\\""}]}');
  });

  it('GET /clips sends no body and parses rows with nullable fields', async () => {
    const row = {
      clip_id: 'c1',
      title: 'A walk',
      filename: 'a.mp4',
      duration_s: null,
      recorded_at: null,
      status: 'uploaded',
      thumb_url: null,
      segment_count: 0,
      people: [],
      duplicate_of: null,
      near_copy_of: null,
      angles: 0,
      size_bytes: 0,
      project_ids: [],
      speech_count: 0,
      face_count: 0,
    };
    const { client, sent } = clientAnswering(200, [row]);

    await expect(client.listClips()).resolves.toEqual([row]);
    expect(sent()).toMatchObject({ url: '/api/clips', method: 'GET', body: undefined });
    expect(sent().headers).toEqual({ Accept: 'application/json' });
  });

  it('rejects a clip row with an unknown status as BAD_RESPONSE', async () => {
    const row = { clip_id: 'c1', title: 'A', filename: 'a.mp4', duration_s: 3, recorded_at: null, status: 'weird', thumb_url: null, segment_count: 0, people: [] };
    const { client } = clientAnswering(200, [row]);

    const error = await captureError(client.listClips());

    expect(error.code).toBe('BAD_RESPONSE');
  });

  it('rejects an upload answer whose part has no URL as BAD_RESPONSE', async () => {
    const { client } = clientAnswering(200, { upload_id: 'u', clip_id: 'c', part_size: 8, parts: [{ n: 1 }] });

    const error = await captureError(client.createUpload({ filename: 'a', size_bytes: 1, content_type: 'video/mp4' }));

    expect(error.code).toBe('BAD_RESPONSE');
  });

  it('POST /session/logout accepts an empty 204', async () => {
    const fetchFn = vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status: 204 }));
    const client = createApiClient({ baseUrl: '/api', timeoutMs: 5000, fetchFn });

    await expect(client.signOut()).resolves.toBe(true);
    const [url, init] = fetchFn.mock.calls[0] ?? [];
    expect(url).toBe('/api/session/logout');
    expect(init?.method).toBe('POST');
    expect(init?.credentials).toBe('include');
  });

  it('GET /costs parses totals per model and rejects a negative call count', async () => {
    const report = { total_usd: 0.084, by_model: [{ model: 'muse-spark-1.3', calls: 12, cost_usd: 0.08 }] };
    const { client, sent } = clientAnswering(200, report);

    await expect(client.getCosts()).resolves.toEqual(report);
    expect(sent()).toMatchObject({ url: '/api/costs', method: 'GET', body: undefined });

    const bad = clientAnswering(200, { total_usd: 1, by_model: [{ model: 'm', calls: -1, cost_usd: 0 }] });
    await expect(bad.client.getCosts()).rejects.toMatchObject({ code: 'BAD_RESPONSE' });
  });
});

