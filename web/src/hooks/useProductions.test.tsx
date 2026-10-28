import { act, useEffect } from 'react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiError, type ApiClient } from '../services/api/client';
import { ERROR, type ProductionDetail } from '../services/api/types';
import { fakeApi, fakeServices, mount, type Mounted } from '../test-support/services';
import {
  useNewProductionForm,
  useProductionArt,
  useStoryShortLookup,
  type NewProductionForm,
  type ProductionArtActions,
} from './useProductions';

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

const form: { current: NewProductionForm | null } = { current: null };
function FormProbe() {
  const current = useNewProductionForm();
  useEffect(() => {
    form.current = current;
  });
  return null;
}
function Where() {
  return <output>{useLocation().pathname}</output>;
}

describe('useNewProductionForm', () => {
  it('sends the trimmed brief with the format’s target length, then opens the new production', async () => {
    const createProduction = vi.fn<ApiClient['createProduction']>().mockResolvedValue({ production_id: 'p 1' });
    view = await mount(
      <MemoryRouter initialEntries={['/productions/new']}>
        <Routes>
          <Route path="/productions/new" element={<FormProbe />} />
          <Route path="*" element={<Where />} />
        </Routes>
      </MemoryRouter>,
      fakeServices({ api: fakeApi({ createProduction }) }),
    );
    expect(form.current?.format).toBe('story');
    expect(form.current?.aspect).toBe('4:5');
    expect(form.current?.blur).toBe(true);

    await act(async () => {
      form.current?.setBrief('  A recap of the weekend  ');
      form.current?.setFormat('short');
      form.current?.setAspect('1:1');
      form.current?.setBlur(false);
      await Promise.resolve();
    });
    await act(async () => {
      form.current?.plan();
      await Promise.resolve();
    });

    expect(createProduction.mock.calls[0]?.[0]).toEqual({
      brief: 'A recap of the weekend',
      format: 'short',
      aspect: '1:1',
      target_s: 20,
      blur_bystanders: false,
    });
    expect(view.container.textContent).toBe('/productions/p%201');
  });

  it('cannot plan an empty brief', async () => {
    view = await mount(
      <MemoryRouter>
        <FormProbe />
      </MemoryRouter>,
      fakeServices(),
    );
    expect(form.current?.canPlan).toBe(true);
    await act(async () => {
      form.current?.setBrief('   ');
      await Promise.resolve();
    });
    expect(form.current?.canPlan).toBe(false);
  });
});

const artProbe: { current: ProductionArtActions | null } = { current: null };
function ArtProbe({ onChanged }: { onChanged: () => void }) {
  const actions = useProductionArt(onChanged);
  useEffect(() => {
    artProbe.current = actions;
  });
  return null;
}

describe('useProductionArt', () => {
  it('starts new art and adds it as a cover, reloading after each; a refusal says why', async () => {
    const newProductionArt = vi.fn<ApiClient['newProductionArt']>().mockResolvedValue({ started: true });
    const useArtAsCover = vi
      .fn<ApiClient['useArtAsCover']>()
      .mockResolvedValueOnce({ platforms: ['tiktok', 'feed'] })
      .mockRejectedValueOnce(new ApiError(ERROR.NOT_FOUND, 'publish the story first', 400));
    const onChanged = vi.fn();
    const services = fakeServices({ api: fakeApi({ newProductionArt, useArtAsCover }) });
    view = await mount(<ArtProbe onChanged={onChanged} />, services);

    const results: (boolean | undefined)[] = [];
    await act(async () => {
      results.push(await artProbe.current?.newArt('p1'), await artProbe.current?.useAsCover('p1'), await artProbe.current?.useAsCover('p1'));
    });

    expect(newProductionArt).toHaveBeenCalledWith('p1');
    expect(useArtAsCover.mock.calls).toEqual([['p1'], ['p1']]);
    expect(results).toEqual([true, true, false]);
    expect(onChanged).toHaveBeenCalledTimes(2);
    expect(services.toasts.getSnapshot().map((t) => t.title)).toEqual(['Key art added as a cover', 'Could not use the art as a cover']);
  });
});
