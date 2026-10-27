import { act, useEffect } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiError, type ApiClient } from '../services/api/client';
import { ERROR, type ProductionDetail } from '../services/api/types';
import { fakeApi, fakeServices, mount, type Mounted } from '../test-support/services';
import { useStoryShortLookup } from './useProductions';

let view: Mounted | null = null;
afterEach(() => {
  view?.unmount();
  view = null;
});

const probe: { current: ((id: string) => Promise<string | null>) | null } = { current: null };
function Probe() {
  const find = useStoryShortLookup();
  useEffect(() => {
    probe.current = find;
  });
  return null;
}

describe('useStoryShortLookup', () => {
  it('reads the story short from the production, null when it has none or the lookup fails', async () => {
    const getProduction = vi
      .fn<ApiClient['getProduction']>()
      .mockResolvedValueOnce({ production: { short_id: 's9' } } as unknown as ProductionDetail)
      .mockResolvedValueOnce({ production: { short_id: null } } as unknown as ProductionDetail)
      .mockRejectedValueOnce(new ApiError(ERROR.NOT_FOUND, 'gone', 404));
    const services = fakeServices({ api: fakeApi({ getProduction }) });
    view = await mount(<Probe />, services);

    const found: (string | null | undefined)[] = [];
    await act(async () => {
      found.push(await probe.current?.('p1'), await probe.current?.('p2'), await probe.current?.('p3'));
    });

    expect(getProduction.mock.calls.map((call) => call[0])).toEqual(['p1', 'p2', 'p3']);
    expect(found).toEqual(['s9', null, null]);
    expect(services.toasts.getSnapshot().map((t) => t.title)).toEqual(['Could not open its short']);
  });
});
