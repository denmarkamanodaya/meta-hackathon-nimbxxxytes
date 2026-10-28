import { act, useEffect } from 'react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiError, type ApiClient } from '../services/api/client';
import { parseGuide } from '../services/api/parse-guides';
import { ERROR, type Guide } from '../services/api/types';
import guideJson from '../test-support/fixtures/guide.json';
import { fakeApi, fakeServices, mount, type Mounted } from '../test-support/services';
import { useEditGuideStep, useGuide, useStartGuide, type EditGuideStep } from './useGuides';
import { useStepAudio, type StepAudioControls } from './useStepAudio';

let view: Mounted | null = null;
afterEach(() => {
  view?.unmount();
  view = null;
  vi.useRealTimers();
});

const parsed = parseGuide(guideJson);
if (parsed === null) throw new Error('guide.json does not parse');
const GUIDE: Guide = parsed;

function Where() {
  return <output>{useLocation().pathname}</output>;
}

describe('useStartGuide', () => {
  const box: { start: ((clipId: string) => void) | null } = { start: null };
  function Probe() {
    const { start } = useStartGuide();
    useEffect(() => {
      box.start = start;
    });
    return <Where />;
  }

  it('starts the guide for the clip and opens it', async () => {
    const startGuide = vi.fn<ApiClient['startGuide']>().mockResolvedValue({ guide_id: 'g 1', status: 'running' });
    view = await mount(
      <MemoryRouter initialEntries={['/clips/c1']}>
        <Routes>
          <Route path="*" element={<Probe />} />
        </Routes>
      </MemoryRouter>,
      fakeServices({ api: fakeApi({ startGuide }) }),
    );

    await act(async () => {
      box.start?.('c1');
      await Promise.resolve();
    });

    expect(startGuide).toHaveBeenCalledWith('c1');
    expect(view.container.textContent).toBe('/guides/g%201');
  });

  it('stays on the clip and raises a toast when the start fails', async () => {
    const startGuide = vi.fn<ApiClient['startGuide']>().mockRejectedValue(new ApiError(ERROR.NOT_FOUND, 'gone', 404));
    const services = fakeServices({ api: fakeApi({ startGuide }) });
    view = await mount(
      <MemoryRouter initialEntries={['/clips/c1']}>
        <Routes>
          <Route path="*" element={<Probe />} />
        </Routes>
      </MemoryRouter>,
      services,
    );

    await act(async () => {
      box.start?.('c1');
      await Promise.resolve();
    });

    expect(view.container.textContent).toBe('/clips/c1');
    expect(services.toasts.getSnapshot().map((t) => t.title)).toEqual(['Could not start the guide']);
  });
});

describe('useGuide', () => {
  function Probe({ id }: { id: string }) {
    const { state } = useGuide(id);
    return <output>{state.status === 'ready' ? `${state.data.status}:${String(state.data.stage)}` : state.status}</output>;
  }

  it('polls while the guide is made and stops once it is ready', async () => {
    vi.useFakeTimers();
    const getGuide = vi
      .fn<ApiClient['getGuide']>()
      .mockResolvedValueOnce({ ...GUIDE, status: 'running', stage: 'voice' })
      .mockResolvedValue(GUIDE);
    view = await mount(<Probe id="g_kettle" />, fakeServices({ api: fakeApi({ getGuide }) }));
    expect(view.container.textContent).toBe('running:voice');

    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000);
    });
    expect(view.container.textContent).toBe('ready:null');
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000);
    });

    expect(getGuide).toHaveBeenCalledTimes(2);
    expect(getGuide.mock.calls[0]?.[0]).toBe('g_kettle');
  });
});

describe('useEditGuideStep', () => {
  const box: { edit: EditGuideStep | null } = { edit: null };
  function Probe({ onSaved }: { onSaved: () => void }) {
    const edit = useEditGuideStep('g_kettle', onSaved);
    useEffect(() => {
      box.edit = edit;
    });
    return null;
  }

  it('sends the step number and exactly the edit, then reloads', async () => {
    const editGuideStep = vi.fn<ApiClient['editGuideStep']>().mockResolvedValue({ ...GUIDE.steps[1], title: 'Close the lid' } as Guide['steps'][number]);
    const onSaved = vi.fn();
    view = await mount(<Probe onSaved={onSaved} />, fakeServices({ api: fakeApi({ editGuideStep }) }));

    let isSaved = false;
    await act(async () => {
      isSaved = (await box.edit?.save(2, { title: 'Close the lid' })) ?? false;
    });

    expect(editGuideStep).toHaveBeenCalledWith('g_kettle', 2, { title: 'Close the lid' });
    expect(isSaved).toBe(true);
    expect(onSaved).toHaveBeenCalledTimes(1);
  });

  it('resolves false with a toast and no reload when the save fails', async () => {
    const editGuideStep = vi.fn<ApiClient['editGuideStep']>().mockRejectedValue(new ApiError(ERROR.FORBIDDEN, 'no', 403));
    const onSaved = vi.fn();
    const services = fakeServices({ api: fakeApi({ editGuideStep }) });
    view = await mount(<Probe onSaved={onSaved} />, services);

    let isSaved = true;
    await act(async () => {
      isSaved = (await box.edit?.save(1, { instruction: 'x' })) ?? true;
    });

    expect(isSaved).toBe(false);
    expect(onSaved).not.toHaveBeenCalled();
    expect(services.toasts.getSnapshot().map((t) => t.title)).toEqual(['Could not save the step']);
  });
});

describe('useStepAudio', () => {
  const box: { audio: StepAudioControls | null } = { audio: null };
  function Probe() {
    const audio = useStepAudio();
    useEffect(() => {
      box.audio = audio;
    });
    return <output>{String(audio.speaking)}</output>;
  }

  it('plays the step URL at once, shows it speaking, and a second tap stops it', async () => {
    const stepAudio = { play: vi.fn(), stop: vi.fn() };
    view = await mount(<Probe />, fakeServices({ stepAudio }));

    act(() => {
      box.audio?.toggle(3, 'https://m/step-3.wav');
    });
    expect(stepAudio.play).toHaveBeenCalledWith('https://m/step-3.wav', expect.any(Function));
    expect(view.container.textContent).toBe('3');

    act(() => {
      box.audio?.toggle(3, 'https://m/step-3.wav');
    });
    expect(stepAudio.stop).toHaveBeenCalledTimes(1);

    act(() => {
      (stepAudio.play.mock.calls[0]?.[1] as () => void)();
    });
    expect(view.container.textContent).toBe('null');
  });

  it('stops the sound when the page closes', async () => {
    const stepAudio = { play: vi.fn(), stop: vi.fn() };
    view = await mount(<Probe />, fakeServices({ stepAudio }));

    view.unmount();
    view = null;

    expect(stepAudio.stop).toHaveBeenCalled();
  });
});
