import { act } from 'react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ApiClient } from '../../services/api/client';
import type { ClipSummary, Project, SearchResponse, SearchResult, SearchStage } from '../../services/api/types';
import clipsJson from '../../test-support/fixtures/clips.json';
import projectsJson from '../../test-support/fixtures/projects.json';
import { createNativeBridge } from '../../services/desktop/native-bridge';
import { fakeTauri } from '../../test-support/fake-tauri';
import { fakeApi, fakeServices, mount, type Mounted } from '../../test-support/services';
import { MacLibraryPage } from './MacLibraryPage';
import { MacSearchRedirect } from './MacSearchRedirect';

let view: Mounted | null = null;
afterEach(() => {
  view?.unmount();
  view = null;
});

const row = (segment_id: string, clip_title: string): SearchResult => ({
  kind: 'moment',
  photo_id: null,
  segment_id,
  clip_id: 'c1',
  start_s: 0,
  end_s: 2,
  thumb_url: null,
  reason: 'Red supercars pass by',
  score: 0.5,
  clip_filename: 'a.mov',
  clip_title,
  recorded_at: null,
  faces: [],
});
const response = (results: SearchResult[]): SearchResponse => ({
  rewritten: { keywords: ['supercars'], filters: { people: [], speakers: [], place: null, from: null, to: null, min_quality: null } },
  results,
  reranked: true,
  took_ms: 3900,
  cached: false,
  cost_usd: 0.003,
});

function Where() {
  const location = useLocation();
  return <output data-testid="where">{`${location.pathname}${location.search}`}</output>;
}

async function openLibrary(at: string, api: Partial<ApiClient>) {
  view = await mount(
    <MemoryRouter initialEntries={[at]}>
      <Routes>
        <Route
          path="/"
          element={
            <>
              <MacLibraryPage />
              <Where />
            </>
          }
        />
        <Route path="/search" element={<MacSearchRedirect />} />
      </Routes>
    </MemoryRouter>,
    fakeServices({
      api: fakeApi({ listClips: vi.fn<ApiClient['listClips']>().mockResolvedValue([]), ...api }),
      desktop: createNativeBridge(fakeTauri().ipc),
    }),
  );
  return view;
}

describe('Mac Gallery search', () => {
  it('shows a spinner through the local stage, then only the final moments, without the clips', async () => {
    let onStage: ((stage: SearchStage) => void) | null = null;
    const searchStream = vi.fn<ApiClient['searchStream']>((_query, next) => {
      onStage = next;
      return new Promise<void>(() => undefined);
    });
    const page = await openLibrary('/?q=supercars', { searchStream });

    expect(searchStream).toHaveBeenCalledWith('supercars', expect.any(Function), expect.any(AbortSignal));
    expect(page.container.textContent).toContain('Searching your clips…');
    expect(page.container.textContent).not.toContain('Your gallery is empty');

    await act(async () => {
      onStage?.({ stage: 'local', response: response([row('s1', 'Kangaroo at bus stop'), row('s2', 'Walking past supercars')]) });
      await Promise.resolve();
    });
    expect(page.container.textContent).toContain('Searching your clips…');
    expect(page.container.textContent).not.toContain('Kangaroo at bus stop');

    await act(async () => {
      onStage?.({ stage: 'ranked', response: response([row('s2', 'Walking past supercars')]) });
      await Promise.resolve();
    });
    expect(page.container.textContent).not.toContain('Searching your clips…');
    expect(page.container.textContent).toContain('Walking past supercars');
    expect(page.container.textContent).not.toContain('Kangaroo at bus stop');
  });

  it('clearing the query goes back to the clips', async () => {
    const searchStream = vi.fn<ApiClient['searchStream']>(() => new Promise<void>(() => undefined));
    const page = await openLibrary('/?q=supercars', { searchStream });

    await act(async () => {
      page.container.querySelector<HTMLButtonElement>('[aria-label="Clear search"]')?.click();
      await Promise.resolve();
    });

    expect(page.container.querySelector('[data-testid="where"]')?.textContent).toBe('/');
    expect(page.container.textContent).toContain('Your gallery is empty');
  });

  it('sends an old /search link to the Gallery with the same query', async () => {
    const searchStream = vi.fn<ApiClient['searchStream']>(() => new Promise<void>(() => undefined));
    const page = await openLibrary('/search?q=Sam', { searchStream });

    expect(page.container.querySelector('[data-testid="where"]')?.textContent).toBe('/?q=Sam');
    expect(searchStream).toHaveBeenCalledWith('Sam', expect.any(Function), expect.any(AbortSignal));
  });
});

describe('Mac Gallery Select mode', () => {
  const clips = clipsJson as ClipSummary[];
  const projects = projectsJson as Project[];
  const button = (root: HTMLElement, label: string) =>
    [...root.querySelectorAll<HTMLButtonElement>('button')].find((item) => item.textContent === label);

  it('puts the ticked clips in a segment from the bar\'s Add to segment menu', async () => {
    const addProjectClips = vi.fn<ApiClient['addProjectClips']>().mockResolvedValue(undefined as never);
    const page = await openLibrary('/', {
      listClips: vi.fn<ApiClient['listClips']>().mockResolvedValue(clips),
      listProjects: vi.fn<ApiClient['listProjects']>().mockResolvedValue(projects),
      addProjectClips,
    });
    act(() => {
      button(page.container, 'Select')?.click();
    });
    const walk = page.container.querySelector<HTMLAnchorElement>('a[aria-label="Walk to work"]');
    act(() => {
      walk?.click();
    });
    act(() => {
      button(page.container, 'Add to segment')?.click();
    });
    const items = [...document.querySelectorAll<HTMLButtonElement>('[role="menu"] button')].map((item) => item.textContent);
    expect(items).toEqual(['60th birthday', 'Australia trip', 'New segment…']);
    expect(document.querySelector('[role="menuitemcheckbox"]')?.getAttribute('aria-checked')).toBe('true');

    await act(async () => {
      // Walk to work is already in 60th birthday (ticked), so Australia trip adds it.
      document.querySelectorAll<HTMLButtonElement>('[role="menuitemcheckbox"]')[1]?.click();
      await Promise.resolve();
    });
    expect(addProjectClips).toHaveBeenCalledWith('prj_trip', ['clip_walk']);
  });
});
