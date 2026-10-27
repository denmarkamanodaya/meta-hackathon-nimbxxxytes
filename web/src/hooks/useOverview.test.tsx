import { act, useEffect } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import peopleOverview from '../test-support/fixtures/people-overview.json';
import { fakeApi, fakeServices, mount, type Mounted } from '../test-support/services';
import { ApiError, type ApiClient } from '../services/api/client';
import type { PeopleOverview } from '../services/api/types';
import {
  useDismissedMatches,
  useHideFaces,
  useNameFaces,
  usePeopleOverview,
  useSettings,
  useTrackVisibility,
} from './useOverview';

let view: Mounted | null = null;
afterEach(() => {
  view?.unmount();
  view = null;
});

const overview = peopleOverview as PeopleOverview;

describe('usePeopleOverview + face actions', () => {
  const handle: {
    setHidden: ((id: string, hidden: boolean) => Promise<boolean>) | null;
    name: ((ids: string[], name: string) => Promise<boolean>) | null;
    hideAll: ((ids: string[]) => Promise<boolean>) | null;
  } = { setHidden: null, name: null, hideAll: null };

  function Probe() {
    const { state, refresh } = usePeopleOverview();
    const setHidden = useTrackVisibility(refresh);
    const name = useNameFaces(refresh);
    const hideAll = useHideFaces(refresh);
    useEffect(() => {
      handle.setHidden = setHidden;
      handle.name = name;
      handle.hideAll = hideAll;
    });
    return <output>{state.status === 'ready' ? String(state.data.unnamed.length) : state.status}</output>;
  }

  it('hides a face with PUT hidden:true and reloads the overview', async () => {
    const getPeopleOverview = vi
      .fn<ApiClient['getPeopleOverview']>()
      .mockResolvedValueOnce(overview)
      .mockResolvedValue({ ...overview, unnamed: overview.unnamed.slice(1) });
    const updateTrack = vi.fn<ApiClient['updateTrack']>().mockResolvedValue({ track_id: 't', crop_url: null, first_s: 0, last_s: 1, person_name: null, hidden: true });
    view = await mount(<Probe />, fakeServices({ api: fakeApi({ getPeopleOverview, updateTrack }) }));
    expect(view.container.textContent).toBe(String(overview.unnamed.length));

    await act(async () => {
      await handle.setHidden?.('tr_neighbour', true);
    });

    expect(updateTrack).toHaveBeenCalledWith('tr_neighbour', { hidden: true });
    expect(getPeopleOverview).toHaveBeenCalledTimes(2);
    expect(view.container.textContent).toBe(String(overview.unnamed.length - 1));
  });

  it('names a whole card with one POST /tracks/name and toasts on failure without reloading', async () => {
    const getPeopleOverview = vi.fn<ApiClient['getPeopleOverview']>().mockResolvedValue(overview);
    const nameTracks = vi.fn<ApiClient['nameTracks']>().mockRejectedValue(new ApiError('TIMEOUT', 'slow', null));
    const services = fakeServices({ api: fakeApi({ getPeopleOverview, nameTracks }) });
    view = await mount(<Probe />, services);

    let ok = true;
    await act(async () => {
      ok = (await handle.name?.(['tr_dog_walk', 'tr_dog_park'], 'Biscuit')) ?? true;
    });

    expect(nameTracks).toHaveBeenCalledWith(['tr_dog_walk', 'tr_dog_park'], 'Biscuit');
    expect(ok).toBe(false);
    expect(getPeopleOverview).toHaveBeenCalledTimes(1);
    expect(services.toasts.getSnapshot()[0]).toMatchObject({ title: 'Could not save the name', code: 'TIMEOUT' });
  });
});

describe('useHideFaces', () => {
  it('hides each face of a card with its own PUT, reloads once, and toasts when one fails', async () => {
    const getPeopleOverview = vi.fn<ApiClient['getPeopleOverview']>().mockResolvedValue(overview);
    const updateTrack = vi
      .fn<ApiClient['updateTrack']>()
      .mockResolvedValueOnce({ track_id: 'a', crop_url: null, first_s: 0, last_s: 1, person_name: null, hidden: true })
      .mockRejectedValueOnce(new ApiError('TIMEOUT', 'slow', null));
    const services = fakeServices({ api: fakeApi({ getPeopleOverview, updateTrack }) });
    let hideAll: ((ids: string[]) => Promise<boolean>) | null = null;
    function Probe() {
      const { refresh } = usePeopleOverview();
      const hide = useHideFaces(refresh);
      useEffect(() => {
        hideAll = hide;
      });
      return null;
    }
    view = await mount(<Probe />, services);

    let ok = true;
    await act(async () => {
      ok = (await (hideAll)?.(['tr_dog_walk', 'tr_dog_park'])) ?? true;
    });

    expect(updateTrack.mock.calls).toEqual([
      ['tr_dog_walk', { hidden: true }],
      ['tr_dog_park', { hidden: true }],
    ]);
    expect(getPeopleOverview).toHaveBeenCalledTimes(2);
    expect(ok).toBe(false);
    expect(services.toasts.getSnapshot()[0]).toMatchObject({ title: 'Could not hide every face' });
  });
});

describe('useDismissedMatches', () => {
  it('reads the session store and re-renders when a suggestion is dismissed', async () => {
    const services = fakeServices();
    let dismiss: ((key: string) => void) | null = null;
    function Probe() {
      const matches = useDismissedMatches();
      useEffect(() => {
        dismiss = matches.dismiss;
      });
      return <output>{[...matches.dismissed].join(',')}</output>;
    }
    view = await mount(<Probe />, services);

    act(() => {
      (dismiss)?.('g_leo');
    });

    expect(view.container.textContent).toBe('g_leo');
  });
});

describe('useSettings', () => {
  it('shows the saved setting, sends PUT with the new value, and keeps the old one when the save fails', async () => {
    const getSettings = vi.fn<ApiClient['getSettings']>().mockResolvedValue({ face_matching: false });
    const updateSettings = vi
      .fn<ApiClient['updateSettings']>()
      .mockResolvedValueOnce({ face_matching: true })
      .mockRejectedValueOnce(new ApiError('TIMEOUT', 'slow', null));
    const services = fakeServices({ api: fakeApi({ getSettings, updateSettings }) });
    let set: ((on: boolean) => Promise<void>) | null = null;
    function Probe() {
      const { state, setFaceMatching } = useSettings();
      useEffect(() => {
        set = setFaceMatching;
      });
      return <output>{state.status === 'ready' ? String(state.faceMatching) : state.status}</output>;
    }
    view = await mount(<Probe />, services);
    expect(view.container.textContent).toBe('false');

    await act(async () => {
      await (set)?.(true);
    });
    expect(updateSettings).toHaveBeenLastCalledWith({ face_matching: true });
    expect(view.container.textContent).toBe('true');

    await act(async () => {
      await (set)?.(false);
    });
    expect(view.container.textContent).toBe('true');
    expect(services.toasts.getSnapshot()[0]).toMatchObject({ title: 'Could not turn off face matching' });
  });
});
