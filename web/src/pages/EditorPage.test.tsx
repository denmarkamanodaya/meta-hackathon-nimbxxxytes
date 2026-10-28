// The multi-clip "Make a short" path end to end in jsdom: the selected clip ids, their details
// from GET /clips/{id}, the round-robin pool in router state, the New short header, and the exact
// POST /shorts body the API receives.
import { act } from 'react';
import { MemoryRouter, Route, Routes } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useMakeShortFromClips } from '../hooks/useClips';
import { createApiClient } from '../services/api/client';
import clipDetail from '../test-support/fixtures/clip-detail.json';
import { fakeServices, mount, type Mounted } from '../test-support/services';
import { EditorPage } from './EditorPage';

let view: Mounted | null = null;
afterEach(() => {
  view?.unmount();
  view = null;
});

/** A second clip whose later moment has the stronger hook. */
const walk = {
  ...clipDetail,
  clip: { ...clipDetail.clip, clip_id: 'clip_walk', title: 'Walk to work', segment_count: 2 },
  segments: [
    { ...clipDetail.segments[0], segment_id: 'walk_start', idx: 0, hook_score: 2, quality: 5 },
    { ...clipDetail.segments[1], segment_id: 'walk_bridge', idx: 1, hook_score: 8, quality: 5 },
  ],
};

const urlOf = (input: RequestInfo | URL) => (typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);

function answer(json: unknown) {
  return Promise.resolve(new Response(JSON.stringify(json), { status: 200, headers: { 'Content-Type': 'application/json' } }));
}

function MakeFromSelection() {
  const makeShort = useMakeShortFromClips();
  return (
    <button
      type="button"
      onClick={() => {
        makeShort(['clip_kitchen', 'clip_walk']);
      }}
    >
      Make a short
    </button>
  );
}

async function settle() {
  await act(async () => {
    for (let i = 0; i < 5; i += 1) await Promise.resolve();
  });
}

describe('Make a short from several Gallery clips', () => {
  it('sends their round-robin pool, best moments first, as segment_ids', async () => {
    const fetchFn = vi.fn<typeof fetch>((input) => {
      const url = urlOf(input);
      if (url === '/api/clips/clip_kitchen') return answer(clipDetail);
      if (url === '/api/clips/clip_walk') return answer(walk);
      if (url === '/api/shorts') return answer({ short_id: 'sh_new' });
      return Promise.reject(new Error(`unexpected ${url}`));
    });
    const api = createApiClient({ baseUrl: '/api', timeoutMs: 5000, fetchFn });
    view = await mount(
      <MemoryRouter initialEntries={['/']}>
        <Routes>
          <Route path="/" element={<MakeFromSelection />} />
          <Route path="/editor" element={<EditorPage />} />
          <Route path="/editor/:id" element={<p>made</p>} />
        </Routes>
      </MemoryRouter>,
      fakeServices({ api }),
    );
    const root = view.container;

    act(() => {
      root.querySelector('button')?.click();
    });
    await settle();
    expect(root.querySelector('.editor-page__subtitle')?.textContent).toBe('6 moments from 2 clips');

    const prompt = root.querySelector('textarea');
    if (prompt === null) throw new Error('the editor asks for the post');
    act(() => {
      // React tracks the value it set; the prototype's setter writes past that, like typing does.
      Reflect.set(HTMLTextAreaElement.prototype, 'value', 'my morning', prompt);
      prompt.dispatchEvent(new Event('input', { bubbles: true }));
    });
    act(() => {
      root.querySelector('form')?.requestSubmit();
    });
    await settle();

    const post = fetchFn.mock.calls.find(([url]) => urlOf(url) === '/api/shorts');
    expect(post?.[1]?.method).toBe('POST');
    expect(post?.[1]?.body).toBe(
      JSON.stringify({
        prompt: 'my morning',
        segment_ids: ['seg_coffee', 'walk_bridge', 'seg_kitchen_toast', 'walk_start', 'seg_kitchen_window', 'seg_kitchen_keys'],
        aspect: '4:5',
        target_s: 15,
      }),
    );
    expect(root.textContent).toBe('made');
  });
});
