import { act, useEffect } from 'react';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeApi, fakeServices, mount, type Mounted } from '../test-support/services';
import { shortDetail, timelineV1, versionWith } from '../test-support/shorts';
import type { ApiClient } from '../services/api/client';
import type { AgentStep } from '../services/api/types';
import type { ShortStepSource } from '../services/events/short-steps';
import { useCreateShort, useEditorHandoff, useFinalRender, useShort } from './useEditor';
import { useTimelineDraft, type TimelineDraft } from './useTimelineDraft';

let view: Mounted | null = null;
afterEach(() => {
  view?.unmount();
  view = null;
  vi.useRealTimers();
});

const step = (seq: number, kind: AgentStep['kind']): AgentStep => ({
  seq,
  kind,
  tool: null,
  version: 1,
  summary: `s${String(seq)}`,
  at: '2026-11-01T10:00:00Z',
});

describe('useEditorHandoff', () => {
  function Probe() {
    const { segmentIds, moments } = useEditorHandoff();
    return <output>{`${segmentIds.join(',')}|${moments.map((m) => m.segment_id).join(',')}`}</output>;
  }

  it('reads ids and keeps only well-formed result rows', async () => {
    const good = {
      segment_id: 's1',
      clip_id: 'c1',
      start_s: 1,
      end_s: 2,
      thumb_url: null,
      reason: null,
      score: 1,
      clip_filename: 'a.mp4',
      clip_title: 'A',
      faces: [],
      recorded_at: null,
    };
    const state = { segmentIds: ['s1', 's2'], moments: [good, { segment_id: 's2' }] };

    view = await mount(
      <MemoryRouter initialEntries={[{ pathname: '/editor', state }]}>
        <Probe />
      </MemoryRouter>,
      fakeServices(),
    );

    expect(view.container.textContent).toBe('s1,s2|s1');
  });
});

describe('useCreateShort', () => {
  it('posts the request and resolves the new short id', async () => {
    const createShort = vi.fn<ApiClient['createShort']>().mockResolvedValue({ short_id: 'sh9' });
    const handle: { create: ReturnType<typeof useCreateShort>['create'] | null } = { create: null };
    function Probe() {
      const { create } = useCreateShort();
      useEffect(() => {
        handle.create = create;
      });
      return null;
    }
    view = await mount(<Probe />, fakeServices({ api: fakeApi({ createShort }) }));
    const request = { prompt: 'p', segment_ids: ['s1'], aspect: '1:1' as const, target_s: 20 };

    let id: string | null = null;
    await act(async () => {
      id = (await handle.create?.(request)) ?? null;
    });

    expect(createShort).toHaveBeenCalledWith(request);
    expect(id).toBe('sh9');
  });
});

describe('useShort', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  function fakeSteps() {
    const listeners: ((s: AgentStep) => void)[] = [];
    const source: ShortStepSource = (_id, onStep) => {
      listeners.push(onStep);
      return () => undefined;
    };
    return { source, push: (s: AgentStep) => { listeners.at(-1)?.(s); } };
  }

  function Probe() {
    const { state, steps } = useShort('sh1', 2000);
    const status = state.status === 'ready' ? state.data.short.status : state.status;
    return <output>{`${status}|${steps.map((s) => String(s.seq)).join(',')}`}</output>;
  }

  it('merges live SSE steps into the polled log and refetches when the final step arrives', async () => {
    const working = { ...shortDetail({ status: 'planning' }), steps: [step(1, 'plan')] };
    const done = { ...shortDetail({ status: 'ready' }), steps: [step(1, 'plan'), step(2, 'critique'), step(3, 'final')] };
    const getShort = vi.fn<ApiClient['getShort']>().mockResolvedValueOnce(working).mockResolvedValue(done);
    const { source, push } = fakeSteps();
    view = await mount(<Probe />, fakeServices({ api: fakeApi({ getShort }), shortSteps: source }));
    expect(view.container.textContent).toBe('planning|1');

    act(() => {
      push(step(2, 'critique'));
    });
    expect(view.container.textContent).toBe('planning|1,2');

    await act(async () => {
      push(step(3, 'final'));
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(getShort).toHaveBeenCalledTimes(2);
    expect(view.container.textContent).toBe('ready|1,2,3');

    await act(async () => {
      await vi.advanceTimersByTimeAsync(20_000);
    });
    expect(getShort).toHaveBeenCalledTimes(2);
  });
});

describe('useFinalRender', () => {
  it('requests the render of the chosen version and restarts polling', async () => {
    const renderShort = vi.fn<ApiClient['renderShort']>().mockResolvedValue({ job_id: 'j1' });
    const refresh = vi.fn();
    const handle: { render: ((n: number) => Promise<void>) | null } = { render: null };
    function Probe() {
      const { state, render } = useFinalRender('sh1', refresh);
      useEffect(() => {
        handle.render = render;
      });
      return <output>{state.status}</output>;
    }
    view = await mount(<Probe />, fakeServices({ api: fakeApi({ renderShort }) }));

    await act(async () => {
      await handle.render?.(2);
    });

    expect(renderShort).toHaveBeenCalledWith('sh1', 2);
    expect(refresh).toHaveBeenCalled();
    expect(view.container.textContent).toBe('requested');
  });
});

describe('useTimelineDraft', () => {
  const detail = shortDetail();
  const handle: { draft: TimelineDraft | null } = { draft: null };

  function Probe({ n }: { n: number }) {
    const version = n === 1 ? versionWith(1, 35) : versionWith(2, 40);
    const draft = useTimelineDraft('sh1', version, detail.segments);
    useEffect(() => {
      handle.draft = draft;
    });
    return <output>{`${draft.clips.map((c) => `${c.segment_id}:${String(c.in)}`).join(',')}|${String(draft.isDirty)}`}</output>;
  }

  it('applies reorder, trim within the segment, and drop; saves the edited clips as a new version', async () => {
    const saveTimeline = vi.fn<ApiClient['saveTimeline']>().mockResolvedValue({ version: 2 });
    view = await mount(<Probe n={1} />, fakeServices({ api: fakeApi({ saveTimeline }) }));

    act(() => {
      handle.draft?.move(1, 0);
    });
    act(() => {
      handle.draft?.trim(0, 'in', 30);
    });
    expect(view.container.textContent).toBe('s7:38,s3:12.6|true');
    act(() => {
      handle.draft?.drop(1);
    });

    let saved: number | null = null;
    await act(async () => {
      saved = (await handle.draft?.save()) ?? null;
    });

    expect(saved).toBe(2);
    const [shortId, timeline] = saveTimeline.mock.calls[0] ?? [];
    expect(shortId).toBe('sh1');
    expect(timeline?.clips.map((c) => [c.segment_id, c.in])).toEqual([['s7', 38]]);
    expect(timeline?.revision).toBeNull();
    expect(view.container.textContent).toBe('s3:12.6,s7:40|false');
  });

  it('starts a fresh draft when another version is shown', async () => {
    view = await mount(<Probe n={1} />, fakeServices());
    act(() => {
      handle.draft?.drop(0);
    });

    view.rerender(<Probe n={2} />);

    expect(view.container.textContent).toBe('s3:12.6,s7:40|false');
  });

  it('saves a user edit of a v2 without the agent revision (the edit answers no critique)', async () => {
    const saveTimeline = vi.fn<ApiClient['saveTimeline']>().mockResolvedValue({ version: 3 });
    const revised = {
      ...timelineV1(),
      revision: { from_version: 1, changes: [{ action: 'trim' as const, detail: 's3', why: 'slow', note_index: 0 }] },
    };
    function Revised() {
      const draft = useTimelineDraft('sh1', versionWith(2, 40, revised), detail.segments);
      useEffect(() => {
        handle.draft = draft;
      });
      return null;
    }
    view = await mount(<Revised />, fakeServices({ api: fakeApi({ saveTimeline }) }));

    act(() => {
      handle.draft?.drop(0);
    });
    await act(async () => {
      await handle.draft?.save();
    });

    expect(saveTimeline.mock.calls[0]?.[1].revision).toBeNull();
  });
});
