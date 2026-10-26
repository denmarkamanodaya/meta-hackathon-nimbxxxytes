import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeApi, fakeServices, mount, type Mounted } from '../test-support/services';
import { ApiError, type ApiClient } from '../services/api/client';
import type { ClipSummary } from '../services/api/types';
import { useClips } from './useClips';

const clip: ClipSummary = {
  clip_id: 'c1',
  filename: 'pov.mp4',
  duration_s: null,
  recorded_at: null,
  status: 'uploaded',
  thumb_url: null,
  segment_count: 0,
  people: [],
};

function Probe() {
  const state = useClips(3000);
  const text =
    state.status === 'ready'
      ? `${state.clips.map((c) => `${c.clip_id}:${c.status}`).join(',')}${state.stale ? ' stale' : ''}`
      : state.status;
  return <output>{text}</output>;
}

let view: Mounted | null = null;
beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  view?.unmount();
  view = null;
  vi.useRealTimers();
});

const advance = (ms: number) =>
  act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });

describe('useClips', () => {
  it('loads clips, then polls again every 3 s and shows the new status', async () => {
    const listClips = vi
      .fn<ApiClient['listClips']>()
      .mockResolvedValueOnce([clip])
      .mockResolvedValue([{ ...clip, status: 'processing' }]);

    view = await mount(<Probe />, fakeServices({ api: fakeApi({ listClips }) }));
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

    view = await mount(<Probe />, fakeServices({ api: fakeApi({ listClips }) }));
    await advance(3000);

    expect(view.container.textContent).toBe('c1:uploaded stale');
  });

  it('shows the error when the first load fails', async () => {
    const listClips = vi
      .fn<ApiClient['listClips']>()
      .mockRejectedValue(new ApiError('NETWORK_ERROR', 'offline', null));

    view = await mount(<Probe />, fakeServices({ api: fakeApi({ listClips }) }));

    expect(view.container.textContent).toBe('error');
  });

  it('stops polling after unmount', async () => {
    const listClips = vi.fn<ApiClient['listClips']>().mockResolvedValue([clip]);
    const mounted = await mount(<Probe />, fakeServices({ api: fakeApi({ listClips }) }));

    mounted.unmount();
    await advance(10_000);

    expect(listClips).toHaveBeenCalledTimes(1);
  });
});
