import { describe, expect, it, vi } from 'vitest';
import { fakeTauri } from '../../test-support/fake-tauri';
import { ApiError, createApiClient } from '../api/client';
import { createInvokeTransport, STREAM_RETRY_MS } from './invoke-transport';

const ok = (status: number, body: string, contentType: string | null = 'application/json') => ({
  resolve: { status, body, content_type: contentType },
});

describe('createInvokeTransport: api_request', () => {
  it('sends a GET as method and the /api-prefixed path only, with no body or content_type keys', async () => {
    const tauri = fakeTauri({ api_request: ok(200, '[]') });
    const client = createApiClient({ baseUrl: '/api', timeoutMs: 5000, transport: createInvokeTransport(tauri.ipc, 5000) });

    await client.listClips();

    expect(tauri.calls).toEqual([{ command: 'api_request', args: { method: 'GET', path: '/api/clips' } }]);
  });

  it('sends a JSON body as a string with content_type application/json', async () => {
    const tauri = fakeTauri({ api_request: ok(200, '{"user_id":"u1"}') });
    const client = createApiClient({ baseUrl: '/api', timeoutMs: 5000, transport: createInvokeTransport(tauri.ipc, 5000) });

    await expect(client.createSession('hunter2')).resolves.toEqual({ user_id: 'u1' });

    expect(tauri.calls[0]?.args).toEqual({
      method: 'POST',
      path: '/api/session',
      body: '{"passcode":"hunter2"}',
      content_type: 'application/json',
    });
  });

  it('keeps escaped ids and the query string in the path', async () => {
    const tauri = fakeTauri({ api_request: ok(200, '[]') });
    const client = createApiClient({ baseUrl: '/api', timeoutMs: 5000, transport: createInvokeTransport(tauri.ipc, 5000) });

    await client.listPeople('a b');

    expect(tauri.calls[0]?.args).toEqual({ method: 'GET', path: '/api/people?prefix=a%20b' });
  });

  it('accepts an empty 204 for sign-out', async () => {
    const tauri = fakeTauri({ api_request: ok(204, '', null) });
    const client = createApiClient({ baseUrl: '/api', timeoutMs: 5000, transport: createInvokeTransport(tauri.ipc, 5000) });

    await expect(client.signOut()).resolves.toBe(true);
    expect(tauri.calls[0]?.args).toEqual({ method: 'POST', path: '/api/session/logout' });
  });

  it('still locks the session on a 401 and rejects with the server code', async () => {
    const tauri = fakeTauri({ api_request: ok(401, '{"error":{"code":"UNAUTHORIZED","message":"no session"}}') });
    const onUnauthorized = vi.fn();
    const client = createApiClient({
      baseUrl: '/api',
      timeoutMs: 5000,
      transport: createInvokeTransport(tauri.ipc, 5000),
      onUnauthorized,
    });

    await expect(client.listClips()).rejects.toMatchObject({ code: 'UNAUTHORIZED', status: 401 });
    expect(onUnauthorized).toHaveBeenCalledTimes(1);
  });

  it('maps a refused native call to NETWORK_ERROR with the native message', async () => {
    const tauri = fakeTauri({ api_request: { reject: 'server url not set' } });
    const transport = createInvokeTransport(tauri.ipc, 5000);

    const error: unknown = await transport.send({ method: 'GET', path: '/clips' }).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ code: 'NETWORK_ERROR', status: null });
    expect((error as ApiError).message).toContain('server url not set');
  });

  it('maps native { code, message } rejections: NETWORK, BAD_RESPONSE, anything else', async () => {
    const send = (reject: { code: string; message: string }) =>
      createInvokeTransport(fakeTauri({ api_request: { reject: reject as unknown as Error } }).ipc, 5000).send({
        method: 'GET',
        path: '/clips',
      });

    await expect(send({ code: 'NETWORK', message: 'connection refused' })).rejects.toMatchObject({
      code: 'NETWORK_ERROR',
      message: 'connection refused',
      status: null,
    });
    await expect(send({ code: 'BAD_RESPONSE', message: 'garbled' })).rejects.toMatchObject({ code: 'BAD_RESPONSE' });
    await expect(send({ code: 'KEYCHAIN', message: 'locked' })).rejects.toMatchObject({
      code: 'DESKTOP_FAILED',
      message: 'locked',
    });
  });

  it('reports a malformed native answer as BAD_RESPONSE', async () => {
    const tauri = fakeTauri({ api_request: { resolve: { status: '200', body: '' } } });
    const transport = createInvokeTransport(tauri.ipc, 5000);

    await expect(transport.send({ method: 'GET', path: '/clips' })).rejects.toMatchObject({ code: 'BAD_RESPONSE' });
  });

  it('rejects with TIMEOUT when the native side does not answer in time', async () => {
    vi.useFakeTimers();
    try {
      const tauri = fakeTauri({ api_request: { run: () => new Promise(() => undefined) } });
      const sent = createInvokeTransport(tauri.ipc, 1000).send({ method: 'GET', path: '/clips' });
      const settled = sent.catch((e: unknown) => e);

      await vi.advanceTimersByTimeAsync(1000);

      await expect(settled).resolves.toMatchObject({ code: 'TIMEOUT' });
    } finally {
      vi.useRealTimers();
    }
  });

  it('rejects with the caller abort reason unchanged and sends nothing when already aborted', async () => {
    const tauri = fakeTauri({ api_request: ok(200, '[]') });
    const controller = new AbortController();
    const reason = new DOMException('aborted', 'AbortError');
    controller.abort(reason);

    await expect(
      createInvokeTransport(tauri.ipc, 5000).send({ method: 'GET', path: '/clips', signal: controller.signal }),
    ).rejects.toBe(reason);
    expect(tauri.calls).toEqual([]);
  });
});

describe('createInvokeTransport: api_stream', () => {
  const streaming = () =>
    fakeTauri({ api_stream: { resolve: { stream_id: 's1' } }, api_stream_cancel: { resolve: null } });

  it('opens the /api-prefixed path with the channel as on_event', async () => {
    const tauri = streaming();

    createInvokeTransport(tauri.ipc, 5000).openStream('/clips/c1/events', vi.fn());
    await Promise.resolve();

    expect(tauri.calls).toEqual([
      { command: 'api_stream', args: { path: '/api/clips/c1/events', on_event: tauri.channels[0] } },
    ]);
  });

  it('delivers unnamed events only and stops at __end', () => {
    const tauri = streaming();
    const onData = vi.fn();
    createInvokeTransport(tauri.ipc, 5000).openStream('/shorts/s/events', onData);
    const channel = tauri.channels[0];

    channel?.push({ event: null, data: '{"a":1}' });
    channel?.push({ event: 'ping', data: 'x' });
    channel?.push({ event: '__end', data: '' });
    channel?.push({ event: null, data: '{"late":true}' });

    expect(onData.mock.calls).toEqual([['{"a":1}']]);
  });

  it('cancels by stream_id on close, and once only', async () => {
    const tauri = streaming();
    const close = createInvokeTransport(tauri.ipc, 5000).openStream('/clips/c1/events', vi.fn());
    await Promise.resolve();
    await Promise.resolve();

    close();
    close();

    expect(tauri.calls.filter((c) => c.command === 'api_stream_cancel')).toEqual([
      { command: 'api_stream_cancel', args: { stream_id: 's1' } },
    ]);
  });

  it('cancels a stream closed before the native side answered, once it answers', async () => {
    const tauri = streaming();
    const close = createInvokeTransport(tauri.ipc, 5000).openStream('/clips/c1/events', vi.fn());

    close();
    await Promise.resolve();
    await Promise.resolve();

    expect(tauri.calls.map((c) => c.command)).toEqual(['api_stream', 'api_stream_cancel']);
  });

  it('reopens after an early __end, and stops reopening once closed', async () => {
    vi.useFakeTimers();
    try {
      const tauri = streaming();
      const onData = vi.fn();
      const close = createInvokeTransport(tauri.ipc, 5000).openStream('/clips/c1/events', onData);
      await vi.advanceTimersByTimeAsync(0);

      tauri.channels[0]?.push({ event: '__end', data: 'connection reset' });
      await vi.advanceTimersByTimeAsync(STREAM_RETRY_MS - 1);
      expect(tauri.calls.filter((c) => c.command === 'api_stream')).toHaveLength(1);
      await vi.advanceTimersByTimeAsync(1);
      expect(tauri.calls.filter((c) => c.command === 'api_stream')).toHaveLength(2);

      tauri.channels[0]?.push({ event: null, data: 'stale' });
      tauri.channels[1]?.push({ event: null, data: 'fresh' });
      close();
      tauri.channels[1]?.push({ event: '__end', data: '' });
      await vi.advanceTimersByTimeAsync(STREAM_RETRY_MS * 2);

      expect(onData.mock.calls).toEqual([['fresh']]);
      expect(tauri.calls.filter((c) => c.command === 'api_stream')).toHaveLength(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it('retries a stream the native side refused to open', async () => {
    vi.useFakeTimers();
    try {
      const tauri = fakeTauri({ api_stream: { reject: 'NOT_SIGNED_IN' } });
      const close = createInvokeTransport(tauri.ipc, 5000).openStream('/clips/c1/events', vi.fn());

      await vi.advanceTimersByTimeAsync(STREAM_RETRY_MS);
      close();
      await vi.advanceTimersByTimeAsync(STREAM_RETRY_MS * 2);

      expect(tauri.calls.filter((c) => c.command === 'api_stream')).toHaveLength(2);
    } finally {
      vi.useRealTimers();
    }
  });
});
