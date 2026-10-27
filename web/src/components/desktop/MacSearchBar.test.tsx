import { act } from 'react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useFocusSearch } from '../../hooks/useSearchBar';
import type { ApiClient } from '../../services/api/client';
import type { ClipDetail, SearchResponse, SearchResult } from '../../services/api/types';
import { fakeApi, fakeServices, mount, type Mounted } from '../../test-support/services';
import { MacColumns } from './MacColumns';
import { MacSearchDock, MacSearchProvider } from './MacSearchBar';

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

const row = (segment_id: string, clip_id: string, start_s: number, end_s: number): SearchResult => ({
  segment_id,
  clip_id,
  start_s,
  end_s,
  thumb_url: null,
  reason: `Reason ${segment_id}`,
  score: 0.5,
  clip_filename: 'a.mov',
  clip_title: `Clip ${clip_id}`,
  recorded_at: null,
  faces: [],
});

const answer: SearchResponse = {
  rewritten: { keywords: ['toast'], filters: { people: [], speakers: [], place: null, from: null, to: null, min_quality: null } },
  results: [row('s1', 'c1', 7.5, 15), row('s2', 'c2', 30, 37)],
  reranked: true,
  took_ms: 900,
  cached: false,
  cost_usd: 0.003,
};

const detail = (clip_id: string, text: string): ClipDetail => ({
  clip: {
    clip_id,
    title: `Clip ${clip_id}`,
    filename: 'a.mov',
    duration_s: 60,
    recorded_at: null,
    status: 'ready',
    thumb_url: null,
    segment_count: 1,
    people: [],
    duplicate_of: null,
    size_bytes: 1,
    project_ids: [],
    speech_count: 1,
    face_count: 0,
  },
  proxy_url: null,
  segments: [],
  turns: [{ turn_id: 't', start_s: 8, end_s: 10, text, speaker_id: null }],
  speakers: [],
  tracks: [],
});

function Where() {
  const location = useLocation();
  return <output data-testid="where">{`${location.pathname}${location.search}`}</output>;
}

function FindMoments() {
  const focus = useFocusSearch();
  return (
    <button
      type="button"
      onClick={() => {
        focus('toast');
      }}
    >
      Find moments
    </button>
  );
}

async function open(api: Partial<ApiClient> = {}) {
  const searchStream = vi.fn<ApiClient['searchStream']>((_query, onStage) => {
    onStage({ stage: 'ranked', response: answer });
    return Promise.resolve();
  });
  view = await mount(
    <MemoryRouter initialEntries={['/shorts']}>
      <MacSearchProvider>
        <Routes>
          <Route
            path="*"
            element={
              <MacColumns>
                <FindMoments />
              </MacColumns>
            }
          />
        </Routes>
        <MacSearchDock />
        <Where />
      </MacSearchProvider>
    </MemoryRouter>,
    fakeServices({
      api: fakeApi({
        searchStream,
        getClip: vi.fn<ApiClient['getClip']>((id) => Promise.resolve(detail(id, id === 'c1' ? 'Toast is ready, catch!' : 'Nice save'))),
        listClips: vi.fn<ApiClient['listClips']>().mockResolvedValue([]),
        listShorts: vi.fn<ApiClient['listShorts']>().mockResolvedValue([]),
        listProjects: vi.fn<ApiClient['listProjects']>().mockResolvedValue([]),
        ...api,
      }),
    }),
  );
  return { page: view, searchStream };
}

const input = () => document.querySelector<HTMLInputElement>('.mac-search__input');
const where = () => document.querySelector('[data-testid="where"]')?.textContent;

async function type(text: string) {
  const field = input();
  if (field === null) throw new Error('no search bar');
  await act(async () => {
    field.focus();
    // React tracks the value it set; the prototype's setter writes past that, like typing does.
    Reflect.set(HTMLInputElement.prototype, 'value', text, field);
    field.dispatchEvent(new Event('input', { bubbles: true }));
    await Promise.resolve();
  });
  await advance(400);
}

async function press(key: string, init: KeyboardEventInit = {}) {
  await act(async () => {
    input()?.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init }));
    await Promise.resolve();
  });
}

describe('Mac search bar', () => {
  it('sits in the page middle column, and ⌘K from anywhere puts the cursor in it', async () => {
    await open();
    expect(document.querySelector('.mac-columns__main .mac-search')).not.toBeNull();

    await act(async () => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', metaKey: true, bubbles: true }));
      await Promise.resolve();
    });
    await advance(20);
    expect(document.activeElement).toBe(input());
  });

  it('a screen can send the owner to the bar with a query typed in', async () => {
    await open();
    await act(async () => {
      document.querySelector<HTMLButtonElement>('button:not(.mac-search__scope)')?.click();
      await Promise.resolve();
    });
    await advance(20);
    expect(input()?.value).toBe('toast');
    expect(document.activeElement).toBe(input());
  });

  it('searches after a pause and sorts the answer into Speech and Moments by what was said', async () => {
    const { searchStream } = await open();
    await type('toast');

    expect(searchStream).toHaveBeenCalledTimes(1);
    expect(searchStream).toHaveBeenCalledWith('toast', expect.any(Function), expect.any(AbortSignal));
    const text = document.querySelector('.mac-search__popover')?.textContent ?? '';
    expect(text).toContain('Speech · 1');
    expect(text).toContain('“Toast is ready, catch!”');
    expect(text).toContain('Moments · 1');
    expect(text).toContain('See all 2 results in the Gallery');
    expect(document.querySelector('.mac-search__match')?.textContent).toBe('Toast');
  });

  it('↓ then ⏎ opens the highlighted moment at its time', async () => {
    await open();
    await type('toast');
    await press('ArrowDown');
    await press('Enter');

    expect(where()).toBe('/clips/c2?t=30');
    expect(input()?.value).toBe('');
  });

  it('⏎ on the first row opens the speech line where it is said', async () => {
    await open();
    await type('toast');
    await press('Enter');

    expect(where()).toBe('/clips/c1?t=8');
  });

  it('⌘⏎ shows every result in the Gallery and keeps the query in the bar', async () => {
    await open();
    await type('toast');
    await press('Enter', { metaKey: true });

    expect(where()).toBe('/?q=toast');
    expect(input()?.value).toBe('toast');
  });

  it('Esc closes the popover and leaves the bar', async () => {
    await open();
    await type('toast');
    expect(document.querySelector('.mac-search__popover')).not.toBeNull();

    await press('Escape');
    expect(document.querySelector('.mac-search__popover')).toBeNull();
    expect(document.activeElement).not.toBe(input());
  });

  it('does not search a single letter', async () => {
    const { searchStream } = await open();
    await type('t');
    expect(searchStream).not.toHaveBeenCalled();
    expect(document.querySelector('.mac-search__popover')).toBeNull();
  });
});
