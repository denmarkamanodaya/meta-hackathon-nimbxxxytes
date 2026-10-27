import { act, useEffect } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import projects from '../test-support/fixtures/projects.json';
import { fakeApi, fakeServices, mount, type Mounted } from '../test-support/services';
import { ApiError, type ApiClient } from '../services/api/client';
import type { ClipSummary, Project } from '../services/api/types';
import { useProjectActions, useProjects, type ProjectActions } from './useProjects';

let view: Mounted | null = null;
afterEach(() => {
  view?.unmount();
  view = null;
});

const list = projects as Project[];
const [birthday] = list;
if (birthday === undefined) throw new Error('projects.json has projects');

const clip = (clip_id: string, project_ids: string[]): ClipSummary => ({
  clip_id,
  title: clip_id,
  filename: `${clip_id}.mp4`,
  duration_s: 10,
  recorded_at: null,
  status: 'ready',
  thumb_url: null,
  segment_count: 1,
  people: [],
  duplicate_of: null,
  size_bytes: 1,
  project_ids,
  speech_count: 0,
  face_count: 0,
});

const handle: { actions: ProjectActions | null } = { actions: null };

function Probe() {
  const { state } = useProjects();
  const actions = useProjectActions();
  useEffect(() => {
    handle.actions = actions;
  });
  return <output>{state.status === 'ready' ? state.data.map((p) => p.name).join('|') : state.status}</output>;
}

describe('useProjects + useProjectActions', () => {
  it('creates a project with the selected clips and reloads the list', async () => {
    const made: Project = { ...birthday, project_id: 'p_new', name: 'Hike' };
    const listProjects = vi.fn<ApiClient['listProjects']>().mockResolvedValueOnce(list).mockResolvedValue([made, ...list]);
    const createProject = vi.fn<ApiClient['createProject']>().mockResolvedValue(made);
    view = await mount(<Probe />, fakeServices({ api: fakeApi({ listProjects, createProject }) }));
    expect(view.container.textContent).toBe('60th birthday|Australia trip');

    let answer: Project | null = null;
    await act(async () => {
      answer = (await handle.actions?.create({ name: 'Hike', color: 'blue', clip_ids: ['c1'] })) ?? null;
    });

    expect(answer).toEqual(made);
    expect(createProject).toHaveBeenCalledWith({ name: 'Hike', color: 'blue', clip_ids: ['c1'] });
    expect(listProjects).toHaveBeenCalledTimes(2);
    expect(view.container.textContent).toBe('Hike|60th birthday|Australia trip');
  });

  it('toggles: adds every clip when one is missing, removes each when all are in', async () => {
    const addProjectClips = vi.fn<ApiClient['addProjectClips']>().mockResolvedValue(birthday);
    const removeProjectClip = vi.fn<ApiClient['removeProjectClip']>().mockResolvedValue(true);
    const listProjects = vi.fn<ApiClient['listProjects']>().mockResolvedValue(list);
    view = await mount(<Probe />, fakeServices({ api: fakeApi({ listProjects, addProjectClips, removeProjectClip }) }));

    await act(async () => {
      await handle.actions?.toggle('prj_birthday', [clip('a', ['prj_birthday']), clip('b', [])]);
    });
    expect(addProjectClips).toHaveBeenCalledWith('prj_birthday', ['a', 'b']);
    expect(removeProjectClip).not.toHaveBeenCalled();

    await act(async () => {
      await handle.actions?.toggle('prj_birthday', [clip('a', ['prj_birthday']), clip('b', ['prj_birthday'])]);
    });
    expect(removeProjectClip.mock.calls).toEqual([['prj_birthday', 'a'], ['prj_birthday', 'b']]);
  });

  it('toasts a failed create and resolves null without reloading', async () => {
    const listProjects = vi.fn<ApiClient['listProjects']>().mockResolvedValue(list);
    const services = fakeServices({
      api: fakeApi({
        listProjects,
        createProject: vi.fn<ApiClient['createProject']>().mockRejectedValue(new ApiError('NETWORK_ERROR', 'offline', null)),
      }),
    });
    const toast = vi.spyOn(services.toasts, 'error');
    view = await mount(<Probe />, services);

    let answer: Project | null = birthday;
    await act(async () => {
      answer = (await handle.actions?.create({ name: '60th Birthday', color: 'grey' })) ?? null;
    });

    expect(answer).toBeNull();
    expect(toast).toHaveBeenCalledWith('Could not make the project', expect.any(ApiError));
    expect(listProjects).toHaveBeenCalledTimes(1);
  });
});
