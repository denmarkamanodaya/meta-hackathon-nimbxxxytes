import { describe, expect, it, vi } from 'vitest';
import type { EventSourceFactory } from './sse';
import { createShortStepSource } from './short-steps';

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

const step = (seq: number, kind: string) =>
  JSON.stringify({ seq, kind, tool: null, version: 1, summary: 's', at: '2026-11-01T10:00:00Z' });

describe('createShortStepSource', () => {
  it('opens /shorts/{id}/events with credentials and delivers parsed steps', () => {
    const { create, opened, push } = fakeEventSource();
    const onStep = vi.fn();

    createShortStepSource('/api', create)('sh 1', onStep);
    push(step(1, 'plan'));
    push('{bad');

    expect(opened[0]?.url).toBe('/api/shorts/sh%201/events');
    expect(opened[0]?.init).toEqual({ withCredentials: true });
    expect(onStep).toHaveBeenCalledTimes(1);
    expect(onStep.mock.calls[0]?.[0]).toMatchObject({ seq: 1, kind: 'plan', version: 1 });
  });

  it('closes after the final step only', () => {
    const { create, opened, push } = fakeEventSource();
    createShortStepSource('/api', create)('sh1', vi.fn());

    push(step(1, 'critique'));
    expect(opened[0]?.close).not.toHaveBeenCalled();
    push(step(2, 'final'));
    expect(opened[0]?.close).toHaveBeenCalled();
  });
});
