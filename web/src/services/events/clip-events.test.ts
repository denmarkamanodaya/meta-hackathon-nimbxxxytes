import { describe, expect, it, vi } from 'vitest';
import { createClipEventSource, type EventSourceFactory } from './clip-events';

/** EventSource double that records how it was opened and lets the test push messages. */
function fakeEventSource() {
  const opened: { url: string; init: EventSourceInit; close: ReturnType<typeof vi.fn> }[] = [];
  let latest: { onmessage: ((m: MessageEvent<string>) => void) | null } | null = null;
  const create: EventSourceFactory = (url, init) => {
    const source = { onmessage: null, close: vi.fn() };
    opened.push({ url, init, close: source.close });
    latest = source;
    return source as unknown as EventSource;
  };
  const push = (data: string) => {
    latest?.onmessage?.(new MessageEvent('message', { data }));
  };
  return { create, opened, push };
}

describe('createClipEventSource', () => {
  it('opens /clips/{id}/events under the API base with credentials', () => {
    const { create, opened } = fakeEventSource();

    createClipEventSource('/api', create)('c/1', vi.fn());

    expect(opened).toHaveLength(1);
    expect(opened[0]?.url).toBe('/api/clips/c%2F1/events');
    expect(opened[0]?.init).toEqual({ withCredentials: true });
  });

  it('delivers parsed events and skips malformed ones', () => {
    const { create, push } = fakeEventSource();
    const onEvent = vi.fn();
    createClipEventSource('/api', create)('c1', onEvent);

    push('{"step":"transcribe","status":"running"}');
    push('not json');
    push('{"step":"teleport","status":"running"}');

    expect(onEvent.mock.calls).toEqual([[{ step: 'transcribe', status: 'running' }]]);
  });

  it('closes the stream once ready is done, or a step fails', () => {
    const { create, opened, push } = fakeEventSource();
    const subscribe = createClipEventSource('/api', create);

    subscribe('c1', vi.fn());
    push('{"step":"index","status":"done"}');
    expect(opened[0]?.close).not.toHaveBeenCalled();
    push('{"step":"ready","status":"done"}');
    expect(opened[0]?.close).toHaveBeenCalled();

    subscribe('c2', vi.fn());
    push('{"step":"faces","status":"failed"}');
    expect(opened[1]?.close).toHaveBeenCalled();
  });

  it('closes the stream on unsubscribe', () => {
    const { create, opened } = fakeEventSource();

    const unsubscribe = createClipEventSource('/api', create)('c1', vi.fn());
    unsubscribe();

    expect(opened[0]?.close).toHaveBeenCalled();
  });
});
