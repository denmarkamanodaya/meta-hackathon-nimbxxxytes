import { act, useEffect } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiError, type ApiClient } from '../services/api/client';
import { fakeApi, fakeServices, mount, type Mounted } from '../test-support/services';
import { timelineV1 } from '../test-support/shorts';
import { useShotSubject, type ShotSubjectHandle } from './useShotSubject';

const timeline = timelineV1();
let view: Mounted | null = null;
afterEach(() => {
  view?.unmount();
  view = null;
});

async function setup(setShotSubject: ApiClient['setShotSubject']) {
  const services = fakeServices({ api: fakeApi({ setShotSubject }) });
  const handle: { current: ShotSubjectHandle | null } = { current: null };
  function Probe() {
    const subject = useShotSubject('sh_1', timeline);
    useEffect(() => {
      handle.current = subject;
    });
    return null;
  }
  view = await mount(<Probe />, services);
  const save = async (index: number, text: string) => {
    let result: number | null = null;
    await act(async () => {
      result = (await handle.current?.save(index, text)) ?? null;
    });
    return result;
  };
  return { services, save };
}

describe('useShotSubject', () => {
  it('saves the trimmed subject for that shot and resolves the new draft', async () => {
    const setShotSubject = vi.fn<ApiClient['setShotSubject']>().mockResolvedValue({ version: 4 });
    const { save } = await setup(setShotSubject);

    await expect(save(1, '  the red bus ')).resolves.toBe(4);
    expect(setShotSubject).toHaveBeenCalledWith('sh_1', timeline, 1, 'the red bus');
  });

  it('skips an empty or unchanged subject', async () => {
    const setShotSubject = vi.fn<ApiClient['setShotSubject']>().mockResolvedValue({ version: 4 });
    const { save } = await setup(setShotSubject);

    await save(0, '   ');
    await save(0, timeline.clips[0]?.subject ?? '');

    expect(setShotSubject).not.toHaveBeenCalled();
  });

  it('toasts a failed save and resolves null', async () => {
    const setShotSubject = vi.fn<ApiClient['setShotSubject']>().mockRejectedValue(new ApiError('TIMEOUT', 'slow', null));
    const { save, services } = await setup(setShotSubject);

    await expect(save(1, 'dog')).resolves.toBeNull();
    expect(services.toasts.getSnapshot()[0]).toMatchObject({ title: 'Could not change the subject' });
  });
});
