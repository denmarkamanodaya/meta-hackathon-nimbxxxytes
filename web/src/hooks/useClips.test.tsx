import { act, useEffect } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeApi, fakeServices, mount, type Mounted } from '../test-support/services';
import { ApiError, type ApiClient } from '../services/api/client';
import { ERROR, type ClipDetail, type ClipEvent, type ClipSummary } from '../services/api/types';
import type { ClipEventSource } from '../services/events/clip-events';
import { useClip, useClipEvents, useClips, useRemoveClip } from './useClips';

const clip: ClipSummary = {
  clip_id: 'c1',
  title: 'Morning walk',
  filename: 'pov.mp4',
  duration_s: null,
  recorded_at: null,
  status: 'uploaded',
  thumb_url: null,
  segment_count: 0,
  people: [],
    duplicate_of: null,
};

const detail = (status: ClipSummary['status']): ClipDetail => ({
  clip: { ...clip, status },
  proxy_url: null,
  segments: [],
  turns: [],
  speakers: [],
  tracks: [],
});

function ListProbe() {
  const { state } = useClips(3000);
  const text =
    state.status === 'ready'
      ? `${state.data.map((c) => `${c.clip_id}:${c.status}`).join(',')}${state.stale ? ' stale' : ''}`
      : state.status;
  return <output>{text}</output>;
}

function DetailProbe() {
  const { state } = useClip('c1', 4000);
  return <output>{state.status === 'ready' ? state.data.clip.status : state.status}</output>;
}

let view: Mounted | null = null;
beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  view?.unmount();
  view = null;
  vi.useRealTimers();
  Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });
});

const advance = (ms: number) =>
  act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });

function setVisibility(state: DocumentVisibilityState) {
  Object.defineProperty(document, 'visibilityState', { value: state, configurable: true });
  document.dispatchEvent(new Event('visibilitychange'));
}

describe('useClips', () => {
  it('loads clips, then polls again every 3 s and shows the new status', async () => {
    const listClips = vi
      .fn<ApiClient['listClips']>()
      .mockResolvedValueOnce([clip])
      .mockResolvedValue([{ ...clip, status: 'processing' }]);

    view = await mount(<ListProbe />, fakeServices({ api: fakeApi({ listClips }) }));
    expect(view.container.textContent).toBe('c1:uploaded');

    await advance(2999);
    expect(listClips).toHaveBeenCalledTimes(1);
    await advance(1);
    expect(listClips).toHaveBeenCalledTimes(2);
    expect(view.container.textContent).toBe('c1:processing');
  });

  it('keeps the last clips and marks them stale when a poll fails', async () => {
    const listClips = vi
      .fn<ApiClient['listClips']>()
      .mockResolvedValueOnce([clip])
      .mockRejectedValue(new ApiError('NETWORK_ERROR', 'offline', null));

    view = await mount(<ListProbe />, fakeServices({ api: fakeApi({ listClips }) }));
    await advance(3000);

    expect(view.container.textContent).toBe('c1:uploaded stale');
  });

  it('shows the error when the first load fails', async () => {
    const listClips = vi
      .fn<ApiClient['listClips']>()
      .mockRejectedValue(new ApiError('NETWORK_ERROR', 'offline', null));

    view = await mount(<ListProbe />, fakeServices({ api: fakeApi({ listClips }) }));

    expect(view.container.textContent).toBe('error');
  });

  it('pauses while the page is hidden and polls at once when it is visible again', async () => {
    const listClips = vi.fn<ApiClient['listClips']>().mockResolvedValue([clip]);
    view = await mount(<ListProbe />, fakeServices({ api: fakeApi({ listClips }) }));

    setVisibility('hidden');
    await advance(30_000);
    expect(listClips).toHaveBeenCalledTimes(1);

    setVisibility('visible');
    await advance(0);
    expect(listClips).toHaveBeenCalledTimes(2);
  });

  it('loads at once even when the page opens hidden (background tab), then pauses', async () => {
    Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true });
    const listClips = vi.fn<ApiClient['listClips']>().mockResolvedValue([clip]);

    view = await mount(<ListProbe />, fakeServices({ api: fakeApi({ listClips }) }));

    expect(view.container.textContent).toBe('c1:uploaded');
    await advance(30_000);
    expect(listClips).toHaveBeenCalledTimes(1);
  });

  it('leaves loading for the error after a failed first load, then recovers on the next poll', async () => {
    const listClips = vi
      .fn<ApiClient['listClips']>()
      .mockRejectedValueOnce(new ApiError('NETWORK_ERROR', 'down', null))
      .mockResolvedValue([clip]);

    view = await mount(<ListProbe />, fakeServices({ api: fakeApi({ listClips }) }));
    expect(view.container.textContent).toBe('error');

    await advance(3000);
    expect(view.container.textContent).toBe('c1:uploaded');
  });

  it('stops polling after unmount', async () => {
    const listClips = vi.fn<ApiClient['listClips']>().mockResolvedValue([clip]);
    const mounted = await mount(<ListProbe />, fakeServices({ api: fakeApi({ listClips }) }));

    mounted.unmount();
    await advance(10_000);

    expect(listClips).toHaveBeenCalledTimes(1);
  });
});

describe('useClip', () => {
  it('requests the clip by id and polls while it is processing, then stops once ready', async () => {
    const getClip = vi
      .fn<ApiClient['getClip']>()
      .mockResolvedValueOnce(detail('processing'))
      .mockResolvedValue(detail('ready'));

    view = await mount(<DetailProbe />, fakeServices({ api: fakeApi({ getClip }) }));
    expect(getClip).toHaveBeenCalledWith('c1', expect.any(AbortSignal));
    expect(view.container.textContent).toBe('processing');

    await advance(4000);
    expect(view.container.textContent).toBe('ready');
    await advance(20_000);
    expect(getClip).toHaveBeenCalledTimes(2);
  });

  it('shows the error when the clip cannot be loaded', async () => {
    const getClip = vi
      .fn<ApiClient['getClip']>()
      .mockRejectedValue(new ApiError('NETWORK_ERROR', 'nope', 404));

    view = await mount(<DetailProbe />, fakeServices({ api: fakeApi({ getClip }) }));

    expect(view.container.textContent).toBe('error');
  });
});

describe('useClipEvents', () => {
  /** Fake SSE source: records subscriptions and lets the test push step events. */
  function fakeEvents() {
    const listeners = new Map<string, (event: ClipEvent) => void>();
    const closed: string[] = [];
    const events: ClipEventSource = (clipId, onEvent) => {
      listeners.set(clipId, onEvent);
      return () => closed.push(clipId);
    };
    return { events, listeners, closed };
  }

  function EventsProbe({ enabled }: { enabled: boolean }) {
    const latest = useClipEvents('c1', enabled);
    return <output>{latest === null ? 'none' : `${latest.step}:${latest.status}`}</output>;
  }

  it('shows each live step from the SSE source and closes it on unmount', async () => {
    const { events, listeners, closed } = fakeEvents();
    const mounted = await mount(<EventsProbe enabled />, fakeServices({ events }));

    act(() => {
      listeners.get('c1')?.({ step: 'transcribe', status: 'running' });
    });
    expect(mounted.container.textContent).toBe('transcribe:running');

    mounted.unmount();
    expect(closed).toEqual(['c1']);
  });

  it('does not open a stream for a clip that is not in progress', async () => {
    const { events, listeners } = fakeEvents();

    view = await mount(<EventsProbe enabled={false} />, fakeServices({ events }));

    expect(listeners.size).toBe(0);
    expect(view.container.textContent).toBe('none');
  });
});

describe('useRemoveClip', () => {
  it('sends DELETE for the clip and resolves true; a failure toasts and resolves false', async () => {
    const deleteClip = vi
      .fn<ApiClient['deleteClip']>()
      .mockResolvedValueOnce(true)
      .mockRejectedValueOnce(new ApiError(ERROR.FORBIDDEN, 'not yours', 403));
    const services = fakeServices({ api: fakeApi({ deleteClip }) });
    const error = vi.spyOn(services.toasts, 'error');
    const probe: { current: ReturnType<typeof useRemoveClip> | null } = { current: null };
    function Probe() {
      const handle = useRemoveClip();
      useEffect(() => {
        probe.current = handle;
      });
      return <output>{handle.state}</output>;
    }
    view = await mount(<Probe />, services);

    let first = false;
    let second = true;
    await act(async () => {
      first = (await probe.current?.remove('clip_kitchen_copy')) ?? false;
    });
    await act(async () => {
      second = (await probe.current?.remove('clip_kitchen')) ?? true;
    });

    expect(deleteClip.mock.calls).toEqual([['clip_kitchen_copy'], ['clip_kitchen']]);
    expect([first, second]).toEqual([true, false]);
    expect(error).toHaveBeenCalledWith('Could not remove this copy', expect.any(ApiError));
    expect(view.container.textContent).toBe('error');
  });
});
