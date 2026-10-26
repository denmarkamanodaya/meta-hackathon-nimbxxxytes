import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeApi, fakeServices, mount, type Mounted } from '../test-support/services';
import { ApiError, type ApiClient } from '../services/api/client';
import type { SearchResponse } from '../services/api/types';
import { usePeopleSuggestions, useSearch } from './useSearch';

const answer: SearchResponse = {
  rewritten: {
    keywords: ['sam', 'beach'],
    filters: { people: ['Sam'], speakers: [], place: null, from: null, to: null, min_quality: null },
  },
  results: [],
  reranked: false,
};

let view: Mounted | null = null;
afterEach(() => {
  view?.unmount();
  view = null;
});

function SearchProbe({ query }: { query: string }) {
  const state = useSearch(query);
  return <output>{state.status === 'done' ? state.response.rewritten.keywords.join(',') : state.status}</output>;
}

describe('useSearch', () => {
  it('stays idle without a query and makes no request', async () => {
    const search = vi.fn<ApiClient['search']>();

    view = await mount(<SearchProbe query="" />, fakeServices({ api: fakeApi({ search }) }));

    expect(view.container.textContent).toBe('idle');
    expect(search).not.toHaveBeenCalled();
  });

  it('searches the query and shows the answer', async () => {
    const search = vi.fn<ApiClient['search']>().mockResolvedValue(answer);

    view = await mount(<SearchProbe query="Sam at the beach" />, fakeServices({ api: fakeApi({ search }) }));

    expect(search).toHaveBeenCalledWith('Sam at the beach', expect.any(AbortSignal));
    expect(view.container.textContent).toBe('sam,beach');
  });

  it('serves a cached answer without a second request (back navigation)', async () => {
    const search = vi.fn<ApiClient['search']>().mockResolvedValue(answer);
    const services = fakeServices({ api: fakeApi({ search }) });
    const first = await mount(<SearchProbe query="beach" />, services);
    first.unmount();

    view = await mount(<SearchProbe query="beach" />, services);

    expect(search).toHaveBeenCalledTimes(1);
    expect(view.container.textContent).toBe('sam,beach');
  });

  it('shows the error when the search fails', async () => {
    const search = vi
      .fn<ApiClient['search']>()
      .mockRejectedValue(new ApiError('TIMEOUT', 'too slow', null));

    view = await mount(<SearchProbe query="beach" />, fakeServices({ api: fakeApi({ search }) }));

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
