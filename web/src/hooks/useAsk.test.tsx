import { act, useEffect } from 'react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AskJob } from '../core/ask/jobs';
import { EVERYTHING } from '../core/search-bar';
import type { ApiClient } from '../services/api/client';
import type { ClipDetail, IntentAnswer, SearchResponse } from '../services/api/types';
import { createNativeBridge } from '../services/desktop/native-bridge';
import { fakeTauri } from '../test-support/fake-tauri';
import { fakeApi, fakeServices, mount, type Mounted } from '../test-support/services';
import { shortDetail } from '../test-support/shorts';
import { AskProvider } from '../components/desktop/AskProvider';
import { NO_MOMENTS, useAsk, type AskQueue } from './useAsk';

let view: Mounted | null = null;
afterEach(() => {
  view?.unmount();
  view = null;
});

const box: { queue: AskQueue | null } = { queue: null };

function Probe() {
  const queue = useAsk();
  const location = useLocation();
  useEffect(() => {
    box.queue = queue;
  });
  return <output data-testid="where">{`${location.pathname}${location.search}`}</output>;
}

const intent = (patch: Partial<IntentAnswer>): IntentAnswer => ({
  kind: 'search',
  title: 'T',
  query: null,
  source: null,
  project_id: null,
  new_project_name: null,
  clip_ids: [],
  target_s: null,
  aspect: null,
  choices: [],
  ...patch,
});

const detail = (clip_id: string): ClipDetail => ({
  clip: {
    clip_id,
    title: clip_id,
    filename: 'a.mov',
    duration_s: 60,
    recorded_at: null,
    status: 'ready',
    thumb_url: null,
    segment_count: 2,
    people: [],
    duplicate_of: null,
    size_bytes: 1,
    project_ids: [],
    speech_count: 0,
    face_count: 0,
  },
  proxy_url: null,
  segments: [0, 1].map((idx) => ({
    segment_id: `${clip_id}-s${String(idx)}`,
    idx,
    start_s: idx * 10,
    end_s: idx * 10 + 8,
    thumb_url: null,
    description: 'd',
    actions: [],
    objects: [],
    place: null,
    mood: null,
    hook_score: 5 - idx,
    quality: 5,
  })),
  turns: [],
  speakers: [],
  tracks: [],
});

async function open(api: Partial<ApiClient>, queued = 2) {
  const tauri = fakeTauri({ pick_and_upload: { resolve: { queued } } });
  view = await mount(
    <MemoryRouter initialEntries={['/']}>
      <Routes>
        <Route
          path="*"
          element={
            <AskProvider>
              <Probe />
            </AskProvider>
          }
        />
      </Routes>
    </MemoryRouter>,
    fakeServices({
      api: fakeApi({ listProjects: vi.fn<ApiClient['listProjects']>().mockResolvedValue([]), ...api }),
      desktop: createNativeBridge(tauri.ipc),
    }),
  );
  return tauri;
}

const settle = () =>
  act(async () => {
    for (let i = 0; i < 10; i += 1) await Promise.resolve();
  });

const queue = (): AskQueue => {
  if (box.queue === null) throw new Error('no queue');
  return box.queue;
};
const first = (): AskJob | undefined => queue().jobs[0];
const where = () => document.querySelector('[data-testid="where"]')?.textContent;

async function sendAndRun(text: string, clipIds: string[] = []) {
  await act(async () => {
    await queue().send(text, clipIds, EVERYTHING);
  });
  await act(async () => {
    queue().run(first()?.id ?? '');
    await Promise.resolve();
  });
  await settle();
}

describe('useAsk (with AskProvider)', () => {
  it('sends the text and the added clips, and a search opens all results without a card', async () => {
    const readIntent = vi.fn<ApiClient['readIntent']>().mockResolvedValue(intent({ kind: 'search', query: 'sunsets' }));
    await open({ readIntent });

    let sent = '';
    await act(async () => {
      sent = await queue().send('sunset at the beach', ['c1'], EVERYTHING);
    });

    expect(readIntent).toHaveBeenCalledWith({ text: 'sunset at the beach', clip_ids: ['c1'] });
    expect(sent).toBe('search');
    expect(where()).toBe('/?q=sunsets');
    expect(queue().jobs).toEqual([]);
  });

  it('keeps any other request as a plan until Run', async () => {
    const createShort = vi.fn<ApiClient['createShort']>();
    await open({ readIntent: vi.fn<ApiClient['readIntent']>().mockResolvedValue(intent({ kind: 'make_short', source: 'search', query: 'sunsets' })), createShort });

    await act(async () => {
      await queue().send('make a short of sunsets', [], EVERYTHING);
    });

    expect(first()).toMatchObject({ status: 'plan', text: 'make a short of sunsets' });
    expect(createShort).not.toHaveBeenCalled();
  });

  it('runs a short from a search: the top moments, the prompt, length and frame, then ticks to Ready', async () => {
    const results = Array.from({ length: 25 }, (_, i) => ({ segment_id: `s${String(i)}` }));
    const search = vi.fn<ApiClient['search']>().mockResolvedValue({ results } as unknown as SearchResponse);
    const createShort = vi.fn<ApiClient['createShort']>().mockResolvedValue({ short_id: 'sh1' });
    const getShort = vi.fn<ApiClient['getShort']>().mockResolvedValue(shortDetail({ status: 'ready' }));
    await open({
      readIntent: vi.fn<ApiClient['readIntent']>().mockResolvedValue(intent({ kind: 'make_short', source: 'search', query: 'sunsets', target_s: 45, aspect: '1:1' })),
      search,
      createShort,
      getShort,
    });

    await sendAndRun('make a 45 s short of sunsets');

    expect(search).toHaveBeenCalledWith('sunsets');
    expect(createShort).toHaveBeenCalledWith({
      segment_ids: results.slice(0, 20).map((r) => r.segment_id),
      prompt: 'make a 45 s short of sunsets',
      target_s: 45,
      aspect: '1:1',
    });
    expect(getShort).toHaveBeenCalledWith('sh1', expect.any(AbortSignal));
    expect(first()).toMatchObject({ status: 'done', shortId: 'sh1', found: 20, rowsDone: 4, score: 35 });
  });

  it('runs a short from the added clips, best moments round-robin', async () => {
    const createShort = vi.fn<ApiClient['createShort']>().mockResolvedValue({ short_id: 'sh1' });
    await open({
      readIntent: vi.fn<ApiClient['readIntent']>().mockResolvedValue(intent({ kind: 'make_short', source: 'attached', clip_ids: ['a', 'b'] })),
      getClip: vi.fn<ApiClient['getClip']>((id) => Promise.resolve(detail(id))),
      createShort,
      getShort: vi.fn<ApiClient['getShort']>().mockResolvedValue(shortDetail({ status: 'planning' })),
    });

    await sendAndRun('make a short', ['a', 'b']);

    expect(createShort.mock.calls[0]?.[0].segment_ids).toEqual(['a-s0', 'b-s0', 'a-s1', 'b-s1']);
    expect(first()).toMatchObject({ status: 'running', rowsDone: 1 });
  });

  it('a short from a project with words takes the matching moments in that project, else the whole project', async () => {
    const results = [
      { segment_id: 'x1', clip_id: 'other' },
      { segment_id: 'a1', clip_id: 'a' },
      { segment_id: 'a2', clip_id: 'a' },
    ];
    const createShort = vi.fn<ApiClient['createShort']>().mockResolvedValue({ short_id: 'sh1' });
    const readIntent = vi.fn<ApiClient['readIntent']>().mockResolvedValue(intent({ kind: 'make_short', source: 'project', project_id: 'p1', query: 'sunsets' }));
    const listProjectClips = vi.fn<ApiClient['listProjectClips']>().mockResolvedValue([detail('a').clip]);
    const getClip = vi.fn<ApiClient['getClip']>((id) => Promise.resolve(detail(id)));
    const getShort = vi.fn<ApiClient['getShort']>().mockResolvedValue(shortDetail({ status: 'planning' }));
    await open({ readIntent, listProjectClips, getClip, createShort, getShort, search: vi.fn<ApiClient['search']>().mockResolvedValue({ results } as unknown as SearchResponse) });

    await sendAndRun('sunsets short from p1');
    expect(createShort.mock.calls[0]?.[0].segment_ids).toEqual(['a1', 'a2']);
    expect(getClip).not.toHaveBeenCalled();

    view?.unmount();
    await open({ readIntent, listProjectClips, getClip, createShort, getShort, search: vi.fn<ApiClient['search']>().mockResolvedValue({ results: results.slice(0, 1) } as unknown as SearchResponse) });
    await sendAndRun('sunsets short from p1');
    expect(createShort.mock.calls[1]?.[0].segment_ids).toEqual(['a-s0', 'a-s1']);
  });

  it('fails a short with no moments and never starts the editor', async () => {
    const createShort = vi.fn<ApiClient['createShort']>();
    await open({
      readIntent: vi.fn<ApiClient['readIntent']>().mockResolvedValue(intent({ kind: 'make_short', source: 'project', project_id: 'p1' })),
      listProjectClips: vi.fn<ApiClient['listProjectClips']>().mockResolvedValue([]),
      createShort,
    });

    await sendAndRun('make a short from p1');

    expect(createShort).not.toHaveBeenCalled();
    expect(first()).toMatchObject({ status: 'failed', error: NO_MOMENTS });
  });

  it('runs a guide from its one clip and follows the stage', async () => {
    const startGuide = vi.fn<ApiClient['startGuide']>().mockResolvedValue({ guide_id: 'g1', status: 'queued' });
    const getGuide = vi.fn<ApiClient['getGuide']>().mockResolvedValue({
      id: 'g1',
      clip_id: 'c9',
      title: 'Kettle',
      status: 'running',
      stage: 'highlight',
      error: null,
      safety: null,
      safety_reason: null,
      language: null,
      steps: [],
      clip_title: null,
      clip_duration_s: null,
    });
    await open({ readIntent: vi.fn<ApiClient['readIntent']>().mockResolvedValue(intent({ kind: 'make_guide', clip_ids: ['c9'] })), startGuide, getGuide });

    await sendAndRun('make a guide', ['c9']);

    expect(startGuide).toHaveBeenCalledWith('c9');
    expect(first()).toMatchObject({ status: 'running', guideId: 'g1', rowsDone: 2 });
  });

  it('an upload opens the file dialog and ends with the files queued; a cancelled dialog drops the job', async () => {
    const readIntent = vi.fn<ApiClient['readIntent']>().mockResolvedValue(intent({ kind: 'upload' }));
    const tauri = await open({ readIntent }, 3);

    await sendAndRun('upload');
    expect(tauri.calls.map((call) => call.command)).toContain('pick_and_upload');
    expect(first()).toMatchObject({ status: 'done', found: 3 });

    view?.unmount();
    await open({ readIntent }, 0);
    await sendAndRun('upload');
    expect(queue().jobs).toEqual([]);
  });

  it('adds clips to a new project: makes it, then adds them', async () => {
    const createProject = vi.fn<ApiClient['createProject']>().mockResolvedValue({ project_id: 'p9' } as Awaited<ReturnType<ApiClient['createProject']>>);
    const addProjectClips = vi.fn<ApiClient['addProjectClips']>().mockResolvedValue({ project_id: 'p9' } as Awaited<ReturnType<ApiClient['addProjectClips']>>);
    await open({
      readIntent: vi.fn<ApiClient['readIntent']>().mockResolvedValue(intent({ kind: 'add_to_project', new_project_name: 'Beach', clip_ids: ['a', 'b'] })),
      createProject,
      addProjectClips,
    });

    await sendAndRun('put these in a new project called Beach', ['a', 'b']);

    expect(createProject).toHaveBeenCalledWith({ name: 'Beach', color: 'orange' });
    expect(addProjectClips).toHaveBeenCalledWith('p9', ['a', 'b']);
    expect(first()).toMatchObject({ status: 'done', projectId: 'p9' });
  });

  it('Stop deletes the short it made and drops the job', async () => {
    const deleteShort = vi.fn<ApiClient['deleteShort']>().mockResolvedValue(true);
    await open({
      readIntent: vi.fn<ApiClient['readIntent']>().mockResolvedValue(intent({ kind: 'make_short', source: 'attached', clip_ids: ['a'] })),
      getClip: vi.fn<ApiClient['getClip']>((id) => Promise.resolve(detail(id))),
      createShort: vi.fn<ApiClient['createShort']>().mockResolvedValue({ short_id: 'sh1' }),
      getShort: vi.fn<ApiClient['getShort']>().mockResolvedValue(shortDetail({ status: 'planning' })),
      deleteShort,
    });
    await sendAndRun('make a short', ['a']);

    await act(async () => {
      queue().stop(first()?.id ?? '');
      await Promise.resolve();
    });

    expect(deleteShort).toHaveBeenCalledWith('sh1');
    expect(queue().jobs).toEqual([]);
  });
});
