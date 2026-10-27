import { describe, expect, it, vi } from 'vitest';
import { createFetchTransport } from './fetch-transport';

describe('createFetchTransport', () => {
  it('sends the body with its content type, the JSON accept header and the session cookie', async () => {
    const fetchFn = vi.fn<typeof fetch>().mockResolvedValue(new Response('{}', { status: 200 }));
    const transport = createFetchTransport({ baseUrl: '/api', timeoutMs: 5000, fetchFn });

    await transport.send({ method: 'PUT', path: '/settings', body: '{"a":1}', contentType: 'application/json' });

    const [url, init] = fetchFn.mock.calls[0] ?? [];
    expect(url).toBe('/api/settings');
    expect(init).toMatchObject({
      method: 'PUT',
      credentials: 'include',
      headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
      body: '{"a":1}',
    });
  });

  it('resolves every status with the raw body text and the content type', async () => {
    const fetchFn = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response('<html>502</html>', { status: 502, headers: { 'Content-Type': 'text/html' } }));
    const transport = createFetchTransport({ baseUrl: '/api', timeoutMs: 5000, fetchFn });

    await expect(transport.send({ method: 'GET', path: '/health' })).resolves.toEqual({
      status: 502,
      body: '<html>502</html>',
      contentType: 'text/html',
    });
  });

  it('streams over EventSource under the base URL with credentials', () => {
    const opened: { url: string; init: EventSourceInit }[] = [];
    const source = { onmessage: null as ((m: MessageEvent<string>) => void) | null, close: vi.fn() };
    const transport = createFetchTransport({
      baseUrl: '/api',
      timeoutMs: 5000,
      createEventSource: (url, init) => {
        opened.push({ url, init });
        return source as unknown as EventSource;
      },
    });
    const onData = vi.fn();

    const close = transport.openStream('/shorts/s1/events', onData);
    source.onmessage?.(new MessageEvent('message', { data: 'x' }));
    close();

    expect(opened).toEqual([{ url: '/api/shorts/s1/events', init: { withCredentials: true } }]);
    expect(onData).toHaveBeenCalledWith('x');
    expect(source.close).toHaveBeenCalledTimes(1);
  });
});
