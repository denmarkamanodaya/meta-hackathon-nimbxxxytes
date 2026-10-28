import { act, useEffect } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '../services/api/client';
import type { ApiClient } from '../services/api/client';
import { isErrorCode, type FindResponse } from '../services/api/types';
import { fakeApi, fakeServices, mount, type Mounted } from '../test-support/services';
import { useObjectPick, type ObjectPick } from './useObjectPick';

const MODEL_UNAVAILABLE = 'MODEL_UNAVAILABLE';
if (!isErrorCode(MODEL_UNAVAILABLE)) throw new Error('error-codes.json lists MODEL_UNAVAILABLE');
const ERROR_MODEL_UNAVAILABLE = MODEL_UNAVAILABLE;

const found: FindResponse = { label: 'mug', in_view: { start_s: 1, end_s: 3 }, outline: null, hits: [] };
const point = { t_s: 2, x: 0.5, y: 0.25 };

let view: Mounted | null = null;
afterEach(() => {
  view?.unmount();
  view = null;
});

async function setup(api: Partial<ApiClient>) {
  const services = fakeServices({ api: fakeApi(api) });
  const handle: { current: ObjectPick | null } = { current: null };
  function Probe() {
    const pick = useObjectPick('c1');
    useEffect(() => {
      handle.current = pick;
    });
    return <output>{pick.state.phase}</output>;
  }
  view = await mount(<Probe />, services);
  const run = async (fn: (pick: ObjectPick) => void) => {
    await act(async () => {
      if (handle.current !== null) fn(handle.current);
      await Promise.resolve();
    });
  };
  return { services, run, phase: () => view?.container.textContent, state: () => handle.current?.state };
}

describe('useObjectPick', () => {
  it('picks, sends the point, and shows what it found', async () => {
    const findThis = vi.fn<ApiClient['findThis']>().mockResolvedValue(found);
    const { run, phase } = await setup({ findThis });

    await run((p) => {
      p.toggle('find');
    });
    expect(phase()).toBe('picking');
    await run((p) => {
      p.pick(point);
    });

    expect(findThis).toHaveBeenCalledWith('c1', point);
    expect(phase()).toBe('found');
  });

  it('ignores a click when not picking (click-to-play stays)', async () => {
    const findThis = vi.fn<ApiClient['findThis']>().mockResolvedValue(found);
    const { run, phase } = await setup({ findThis });

    await run((p) => {
      p.pick(point);
    });

    expect(findThis).not.toHaveBeenCalled();
    expect(phase()).toBe('off');
  });

  it('cancels picking with Esc, and a toggle of the same button turns it off', async () => {
    const { run, phase } = await setup({});

    await run((p) => {
      p.toggle('find');
    });
    await act(async () => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
      await Promise.resolve();
    });
    expect(phase()).toBe('off');

    await run((p) => {
      p.toggle('cutout');
    });
    await run((p) => {
      p.toggle('cutout');
    });
    expect(phase()).toBe('off');
  });

  it('drops an answer that comes back after Esc', async () => {
    let resolve: (value: FindResponse) => void = () => undefined;
    const findThis = vi.fn<ApiClient['findThis']>(() => new Promise((r) => { resolve = r; }));
    const { run, phase } = await setup({ findThis });

    await run((p) => {
      p.toggle('find');
    });
    await run((p) => {
      p.pick(point);
    });
    expect(phase()).toBe('working');
    await act(async () => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
      resolve(found);
      await Promise.resolve();
    });

    expect(phase()).toBe('off');
  });

  it('shows a failure with the server’s message, and Try again sends the same point again', async () => {
    const cutOut = vi
      .fn<ApiClient['cutOut']>()
      .mockRejectedValueOnce(new ApiError(ERROR_MODEL_UNAVAILABLE, 'SAM 3.1 did not answer within 50 s', 503))
      .mockResolvedValueOnce({ label: 'dog', png_url: '/a.png', sticker_url: '/b.png' });
    const { run, phase, state } = await setup({ cutOut });

    await run((p) => {
      p.toggle('cutout');
    });
    await run((p) => {
      p.pick(point);
    });
    expect(phase()).toBe('failed');
    expect(state()).toMatchObject({ phase: 'failed', purpose: 'cutout', message: 'SAM 3.1 did not answer within 50 s' });

    await run((p) => {
      p.retry();
    });
    expect(cutOut).toHaveBeenCalledTimes(2);
    expect(cutOut).toHaveBeenLastCalledWith('c1', point);
    expect(phase()).toBe('cut');
  });

  it('leaves a failure with Esc', async () => {
    const findThis = vi.fn<ApiClient['findThis']>().mockRejectedValue(new ApiError('TIMEOUT', 'slow', null));
    const { run, phase } = await setup({ findThis });

    await run((p) => {
      p.toggle('find');
    });
    await run((p) => {
      p.pick(point);
    });
    expect(phase()).toBe('failed');
    await act(async () => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
      await Promise.resolve();
    });
    expect(phase()).toBe('off');
  });
});
