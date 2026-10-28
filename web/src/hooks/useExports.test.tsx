import { act, useEffect } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import exportsPack from '../test-support/fixtures/exports.json';
import { fakeApi, fakeServices, mount, type Mounted } from '../test-support/services';
import { ApiError, type ApiClient } from '../services/api/client';
import { parseExports } from '../services/api/parse-studio';
import { ERROR, type ExportItem, type ExportsResponse } from '../services/api/types';
import { useCoverControls, type CoverControls } from './useCoverControls';
import { isExportsRunning, useExports, type ExportsHandle } from './useExports';

let view: Mounted | null = null;
afterEach(() => {
  view?.unmount();
  view = null;
  vi.useRealTimers();
});

const fixture = parseExports(exportsPack);
const tiktok = fixture?.exports[0];
if (tiktok === undefined) throw new Error('exports.json has exports');

const withCovers: ExportItem = {
  ...tiktok,
  covers: [
    { url: 'a', style: 'bright', instruction: null, background: null },
    { url: 'b', style: 'close_detail', instruction: null, background: null },
    { url: 'c', style: 'dramatic', instruction: null, background: null },
  ],
  cover_pick: 0,
  cover_title: { text: 'Nap champion', show: true, position: 'bottom' },
};
const answer = (busy: boolean, item: ExportItem = withCovers): ExportsResponse => ({ exports: [item], busy });

const seen: { handle: ExportsHandle | null; controls: CoverControls | null } = { handle: null, controls: null };

function Probe() {
  const handle = useExports('sh1', 10);
  const item = handle.state.status === 'ready' ? (handle.state.data.exports[0] ?? null) : null;
  useEffect(() => {
    seen.handle = handle;
  });
  return item === null ? null : <Controls item={item} handle={handle} isBusy={handle.state.status === 'ready' && handle.state.data.busy} />;
}

function Controls({ item, handle, isBusy }: { item: ExportItem; handle: ExportsHandle; isBusy: boolean }) {
  const controls = useCoverControls(item, handle, isBusy);
  useEffect(() => {
    seen.controls = controls;
  });
  return null;
}

const settle = async () => {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
};

describe('useExports + useCoverControls', () => {
  it('redraws the selected cover with the words, shows it as redrawing until a later answer is idle', async () => {
    const listExports = vi
      .fn<ApiClient['listExports']>()
      .mockResolvedValueOnce(answer(false))
      .mockResolvedValueOnce(answer(true))
      .mockResolvedValue(answer(false));
    const redrawCover = vi.fn<ApiClient['redrawCover']>().mockResolvedValue({ started: true });
    view = await mount(<Probe />, fakeServices({ api: fakeApi({ listExports, redrawCover }) }));
    await settle();

    await act(async () => {
      seen.controls?.select(2);
      seen.controls?.setWords('golden hour');
      await Promise.resolve();
    });
    expect(seen.controls?.canRedraw).toBe(true);
    await act(async () => {
      seen.controls?.redraw();
      await Promise.resolve();
    });
    await settle();

    expect(redrawCover).toHaveBeenCalledWith('sh1', 'tiktok', 2, 'golden hour');
    expect(seen.controls?.words).toBe('');
    expect(seen.handle?.redrawing.has('tiktok')).toBe(true);
    expect(seen.controls?.isRedrawing).toBe(true);

    await act(async () => {
      seen.handle?.refresh();
      await Promise.resolve();
    });
    await settle();
    expect(seen.handle?.redrawing.has('tiktok')).toBe(false);
  });

  it('asks for more covers in the chosen style, and saves the title on commit only when it changed', async () => {
    const listExports = vi.fn<ApiClient['listExports']>().mockResolvedValue(answer(false));
    const moreCovers = vi.fn<ApiClient['moreCovers']>().mockResolvedValue({ started: true });
    const editExport = vi.fn<ApiClient['editExport']>().mockResolvedValue(true);
    view = await mount(<Probe />, fakeServices({ api: fakeApi({ listExports, moreCovers, editExport }) }));
    await settle();

    await act(async () => {
      seen.controls?.setStyle('illustrated');
      await Promise.resolve();
    });
    await act(async () => {
      seen.controls?.more();
      seen.controls?.commitTitle();
      seen.controls?.typeTitle(`  Old soul${'!'.repeat(40)}`);
      await Promise.resolve();
    });
    expect(seen.controls?.titleText).toHaveLength(32);
    expect(seen.controls?.overlay?.text).toBe(`Old soul${'!'.repeat(22)}`);
    await act(async () => {
      seen.controls?.typeTitle('  Old soul ');
      await Promise.resolve();
    });
    await act(async () => {
      seen.controls?.commitTitle();
      seen.controls?.setPosition('top');
      await Promise.resolve();
    });

    expect(moreCovers).toHaveBeenCalledWith('sh1', 'tiktok', 'illustrated');
    expect(editExport.mock.calls.map((call) => call[2])).toEqual([
      { cover_title: { text: 'Old soul', show: true, position: 'bottom' } },
      { cover_title: { text: 'Nap champion', show: true, position: 'top' } },
    ]);
  });

  it('previews a tile without saving it; Use saves the pick and rolls back when the save fails', async () => {
    const listExports = vi.fn<ApiClient['listExports']>().mockResolvedValue(answer(false));
    const editExport = vi.fn<ApiClient['editExport']>().mockRejectedValue(new ApiError(ERROR.INTERNAL, 'boom', 500));
    const services = fakeServices({ api: fakeApi({ listExports, editExport }) });
    view = await mount(<Probe />, services);
    await settle();

    await act(async () => {
      seen.controls?.select(1);
      await Promise.resolve();
    });
    expect(seen.controls?.selected?.index).toBe(1);
    expect(seen.controls?.tiles.map((t) => t.isPicked)).toEqual([true, false, false]);
    expect(editExport).not.toHaveBeenCalled();

    await act(async () => {
      seen.controls?.use(1);
      await Promise.resolve();
    });
    await settle();

    expect(editExport).toHaveBeenCalledWith('sh1', 'tiktok', { cover_pick: 1 });
    expect(seen.controls?.tiles.map((t) => t.isPicked)).toEqual([true, false, false]);
    expect(services.toasts.getSnapshot().map((t) => t.title)).toEqual(['Could not save the change']);
  });
});

describe('isExportsRunning', () => {
  it('keeps polling while a ready export with covers waits for its titled cover', () => {
    const ready: ExportItem = {
      ...tiktok,
      status: 'ready',
      covers: [{ url: 'https://x/0.webp', style: 'bright', instruction: null, background: null }],
      download_cover_url: 'https://x/c.jpg',
    };
    const pack = (e: ExportItem): ExportsResponse => ({ exports: [e], busy: false });
    expect(isExportsRunning(pack(ready))).toBe(false);
    expect(isExportsRunning(pack({ ...ready, download_cover_url: null }))).toBe(true);
    expect(isExportsRunning(pack({ ...ready, download_cover_url: null, covers: [] }))).toBe(false);
    expect(isExportsRunning({ exports: [ready], busy: true })).toBe(true);
  });
});
