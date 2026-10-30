import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeApi, fakeServices, mount, type Mounted } from '../test-support/services';
import { ApiError, type ApiClient } from '../services/api/client';
import type { SearchResponse, SearchResult, SearchStage } from '../services/api/types';
import { usePeopleSuggestions, useSearch } from './useSearch';

const answer: SearchResponse = {
  rewritten: {
    keywords: ['sam', 'beach'],
    filters: { people: ['Sam'], speakers: [], place: null, from: null, to: null, min_quality: null },
  },
  results: [],
  reranked: false, took_ms: 60, cached: false, cost_usd: 0,
};

let view: Mounted | null = null;
afterEach(() => {
  view?.unmount();
  view = null;
});

function SearchProbe({ query }: { query: string }) {
  const state = useSearch(query);
  if (state.status !== 'done') return <output>{state.status}</output>;
  const ids = state.response.results.map((r) => r.segment_id).join(',');
  const keywords = state.response.rewritten.keywords.join(',');
  return <output>{`${keywords}|${ids}|${state.isRefining ? 'refining' : 'final'}|${String(state.localTookMs)}`}</output>;
}

const row = (segment_id: string): SearchResult => ({
  kind: 'moment',
  photo_id: null,
  segment_id,
  clip_id: 'c1',
  start_s: 0,
  end_s: 2,
  thumb_url: null,
  reason: null,
  score: 0.5,
  clip_filename: 'a.mp4',
  clip_title: 'A',
  recorded_at: null,
  faces: [],
});
const local: SearchResponse = { ...answer, results: [row('s1'), row('s2')], took_ms: 200 };
const ranked: SearchResponse = { ...answer, results: [row('s2'), row('s1')], reranked: true, took_ms: 3900 };

/** A searchStream stub the test drives stage by stage. */
function drivenStream() {
  const control: {
    onStage: ((stage: SearchStage) => void) | null;
    resolve: () => void;
    reject: (error: unknown) => void;
  } = { onStage: null, resolve: () => undefined, reject: () => undefined };
  const searchStream = vi.fn<ApiClient['searchStream']>(
    (_query, onStage) =>
      new Promise<void>((resolve, reject) => {
        control.onStage = onStage;
        control.resolve = resolve;
        control.reject = reject;
      }),
  );
  const emit = async (stage: SearchStage) => {
    await act(async () => {
      control.onStage?.(stage);
      await Promise.resolve();
    });
  };
  const end = async (error?: unknown) => {
    await act(async () => {
      if (error === undefined) control.resolve();
      else control.reject(error);
      await Promise.resolve();
    });
  };
  return { searchStream, emit, end };
}

describe('useSearch', () => {
  it('stays idle without a query and makes no request', async () => {
    const searchStream = vi.fn<ApiClient['searchStream']>();

    view = await mount(<SearchProbe query="" />, fakeServices({ api: fakeApi({ searchStream }) }));

    expect(view.container.textContent).toBe('idle');
    expect(searchStream).not.toHaveBeenCalled();
  });

  it('keeps searching through the local stage, then shows only the ranked order with the local time', async () => {
    const stream = drivenStream();
    view = await mount(<SearchProbe query="Sam at the beach" />, fakeServices({ api: fakeApi({ searchStream: stream.searchStream }) }));
    expect(stream.searchStream).toHaveBeenCalledWith('Sam at the beach', expect.any(Function), expect.any(AbortSignal));
    expect(view.container.textContent).toBe('searching');

    await stream.emit({ stage: 'local', response: local });
    expect(view.container.textContent).toBe('searching');

    await stream.emit({ stage: 'ranked', response: ranked });
    await stream.end();
    expect(view.container.textContent).toBe('sam,beach|s2,s1|final|200');
  });

  it('shows a ranked-only answer (fallback) as final', async () => {
    const stream = drivenStream();
    view = await mount(<SearchProbe query="beach" />, fakeServices({ api: fakeApi({ searchStream: stream.searchStream }) }));

    await stream.emit({ stage: 'ranked', response: ranked });
    await stream.end();

    expect(view.container.textContent).toBe('sam,beach|s2,s1|final|null');
  });

  it('shows the held local results when the stream fails after them', async () => {
    const stream = drivenStream();
    const services = fakeServices({ api: fakeApi({ searchStream: stream.searchStream }) });
    view = await mount(<SearchProbe query="beach" />, services);

    await stream.emit({ stage: 'local', response: local });
    await stream.end(new ApiError('NETWORK_ERROR', 'Could not reach the server', null));

    expect(view.container.textContent).toBe('sam,beach|s1,s2|final|null');
    expect(services.searchCache.get('beach')).toBeUndefined();
  });

  it('serves the cached ranked answer without a second request (back navigation)', async () => {
    const stream = drivenStream();
    const services = fakeServices({ api: fakeApi({ searchStream: stream.searchStream }) });
    const first = await mount(<SearchProbe query="beach" />, services);
    await stream.emit({ stage: 'local', response: local });
    await stream.emit({ stage: 'ranked', response: ranked });
    await stream.end();
    first.unmount();

    view = await mount(<SearchProbe query="beach" />, services);

    expect(stream.searchStream).toHaveBeenCalledTimes(1);
    expect(view.container.textContent).toBe('sam,beach|s2,s1|final|null');
  });

  it('shows the error when the search fails before any results', async () => {
    const searchStream = vi
      .fn<ApiClient['searchStream']>()
      .mockRejectedValue(new ApiError('TIMEOUT', 'too slow', null));

    view = await mount(<SearchProbe query="beach" />, fakeServices({ api: fakeApi({ searchStream }) }));

    expect(view.container.textContent).toBe('error');
  });
});

describe('usePeopleSuggestions', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  function SuggestProbe({ prefix }: { prefix: string }) {
    return <output>{usePeopleSuggestions(prefix, 200).map((p) => p.name).join(',')}</output>;
  }

  it('waits 200 ms after the last keystroke and sends only the final prefix', async () => {
    const listPeople = vi
      .fn<ApiClient['listPeople']>()
      .mockResolvedValue([{ person_id: 'p1', name: 'Sam' }]);
    const services = fakeServices({ api: fakeApi({ listPeople }) });
    const root = await mount(<SuggestProbe prefix="S" />, services);
    view = root;

    await act(async () => {
      await vi.advanceTimersByTimeAsync(150);
    });
    root.rerender(<SuggestProbe prefix="Sa" />);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(199);
    });
    expect(listPeople).not.toHaveBeenCalled();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });
    expect(listPeople).toHaveBeenCalledTimes(1);
    expect(listPeople).toHaveBeenCalledWith('Sa', expect.any(AbortSignal));
    expect(root.container.textContent).toBe('Sam');
  });

  it('asks nothing for a blank prefix', async () => {
    const listPeople = vi.fn<ApiClient['listPeople']>();
    view = await mount(<SuggestProbe prefix="  " />, fakeServices({ api: fakeApi({ listPeople }) }));

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });

    expect(listPeople).not.toHaveBeenCalled();
  });
});
