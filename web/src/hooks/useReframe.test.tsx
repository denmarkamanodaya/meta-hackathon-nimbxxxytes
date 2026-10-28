import { act } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ApiClient } from '../services/api/client';
import type { ReframeResponse } from '../services/api/types';
import { fakeApi, fakeServices, mount, type Mounted } from '../test-support/services';
import { useReframe } from './useReframe';

let view: Mounted | null = null;
afterEach(() => {
  view?.unmount();
  view = null;
  vi.useRealTimers();
});

const idle: ReframeResponse = { status: 'idle', shots: [] };
const running: ReframeResponse = { status: 'running', shots: [] };
const ready: ReframeResponse = { status: 'ready', shots: [{ segment_id: 's1', subject: 'dog', frames_tracked: 10, frames_total: 10, lost_s: 0 }] };

function Probe({ keep, subjects }: { keep: boolean | null; subjects: string }) {
  const { state } = useReframe('sh_1', keep, subjects, 5);
  return <output>{state.status === 'ready' ? state.data.status : state.status}</output>;
}

const settle = () =>
  act(async () => {
    await new Promise((resolve) => {
      setTimeout(resolve, 30);
    });
  });

describe('useReframe', () => {
  it('starts once when the switch is on and nothing ran, then polls until ready', async () => {
    const getReframe = vi.fn<ApiClient['getReframe']>().mockResolvedValueOnce(idle).mockResolvedValueOnce(running).mockResolvedValue(ready);
    const startReframe = vi.fn<ApiClient['startReframe']>().mockResolvedValue({ started: true });
    view = await mount(<Probe keep subjects="dog" />, fakeServices({ api: fakeApi({ getReframe, startReframe }) }));
    await settle();

    expect(startReframe).toHaveBeenCalledTimes(1);
    expect(startReframe).toHaveBeenCalledWith('sh_1');
    expect(view.container.textContent).toBe('ready');
  });

  it('starts nothing with the switch off or the finish still loading', async () => {
    const getReframe = vi.fn<ApiClient['getReframe']>().mockResolvedValue(idle);
    const startReframe = vi.fn<ApiClient['startReframe']>().mockResolvedValue({ started: true });
    const services = fakeServices({ api: fakeApi({ getReframe, startReframe }) });
    view = await mount(<Probe keep={false} subjects="dog" />, services);
    await settle();
    view.rerender(<Probe keep={null} subjects="dog" />);
    await settle();

    expect(startReframe).not.toHaveBeenCalled();
  });

  it('never starts twice for the same subjects when the answer stays idle, but does for a new subject', async () => {
    const getReframe = vi.fn<ApiClient['getReframe']>().mockResolvedValue(idle);
    const startReframe = vi.fn<ApiClient['startReframe']>().mockResolvedValue({ started: true });
    view = await mount(<Probe keep subjects="dog" />, fakeServices({ api: fakeApi({ getReframe, startReframe }) }));
    await settle();
    expect(startReframe).toHaveBeenCalledTimes(1);

    view.rerender(<Probe keep subjects="cat" />);
    await settle();
    expect(startReframe).toHaveBeenCalledTimes(2);
  });
});
