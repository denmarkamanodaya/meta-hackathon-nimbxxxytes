import { afterEach, describe, expect, it, vi } from 'vitest';
import { fakeApi, fakeServices, mount, type Mounted } from '../test-support/services';
import { ApiError, type ApiClient } from '../services/api/client';
import { useHealth } from './useHealth';

function Probe() {
  return <output>{useHealth()}</output>;
}

let view: Mounted | null = null;
afterEach(() => {
  view?.unmount();
  view = null;
});

const withHealth = (getHealth: ApiClient['getHealth']) =>
  mount(<Probe />, fakeServices({ api: fakeApi({ getHealth }) }));

describe('useHealth', () => {
  it('shows online when the server answers ok', async () => {
    const getHealth = vi.fn<ApiClient['getHealth']>().mockResolvedValue({ ok: true });

    view = await withHealth(getHealth);

    expect(view.container.textContent).toBe('online');
    expect(getHealth).toHaveBeenCalledWith(expect.any(AbortSignal));
  });

  it('shows offline when the call rejects with an ApiError', async () => {
    const getHealth = vi
      .fn<ApiClient['getHealth']>()
      .mockRejectedValue(new ApiError('NETWORK_ERROR', 'down', null));

    view = await withHealth(getHealth);

    expect(view.container.textContent).toBe('offline');
  });

  it('shows offline when the server answers ok: false', async () => {
    view = await withHealth(vi.fn<ApiClient['getHealth']>().mockResolvedValue({ ok: false }));

    expect(view.container.textContent).toBe('offline');
  });

  it('stays checking while the call is pending and aborts it on unmount', async () => {
    const getHealth = vi.fn<ApiClient['getHealth']>().mockReturnValue(new Promise(() => undefined));

    const mounted = await withHealth(getHealth);
    const signal = getHealth.mock.calls[0]?.[0];

    expect(mounted.container.textContent).toBe('checking');
    mounted.unmount();
    expect(signal?.aborted).toBe(true);
  });
});
