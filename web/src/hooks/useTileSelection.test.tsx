import { act, type MouseEvent } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { fakeServices, mount, type Mounted } from '../test-support/services';
import { useTileSelection, type TileSelection } from './useTileSelection';

let view: Mounted | null = null;
afterEach(() => {
  view?.unmount();
  view = null;
});

async function mountSelection() {
  const probe: { current: TileSelection | null } = { current: null };
  function Probe() {
    probe.current = useTileSelection();
    return null;
  }
  view = await mount(<Probe />, fakeServices());
  return probe;
}

function click(metaKey: boolean) {
  const preventDefault = vi.fn();
  return { event: { metaKey, preventDefault } as unknown as MouseEvent<HTMLElement>, preventDefault };
}

describe('useTileSelection', () => {
  it('selects with ⌘-click and keeps the page; a plain click clears and lets the link open', async () => {
    const probe = await mountSelection();
    const first = click(true);
    const plain = click(false);

    act(() => {
      probe.current?.click('a', first.event);
    });
    act(() => {
      probe.current?.click('b', click(true).event);
    });
    expect(probe.current?.selected).toEqual(['a', 'b']);
    expect(first.preventDefault).toHaveBeenCalled();

    act(() => {
      probe.current?.click('c', plain.event);
    });
    expect(probe.current?.selected).toEqual([]);
    expect(plain.preventDefault).not.toHaveBeenCalled();
  });

  it('keeps every tile of fast ⌘-clicks that land before a re-render', async () => {
    const probe = await mountSelection();

    act(() => {
      probe.current?.click('a', click(true).event);
      probe.current?.click('b', click(true).event);
      probe.current?.click('c', click(true).event);
    });

    expect(probe.current?.selected).toEqual(['a', 'b', 'c']);
  });

  it('right-click acts on the selection it is part of, else on that tile alone', async () => {
    const probe = await mountSelection();
    act(() => {
      probe.current?.click('a', click(true).event);
    });
    act(() => {
      probe.current?.click('b', click(true).event);
    });

    let ids: string[] = [];
    act(() => {
      ids = probe.current?.targetsFor('b') ?? [];
    });
    expect(ids).toEqual(['a', 'b']);

    act(() => {
      ids = probe.current?.targetsFor('z') ?? [];
    });
    expect(ids).toEqual(['z']);
    expect(probe.current?.selected).toEqual(['z']);
  });

  it('clears on Esc and forgets deleted ids', async () => {
    const probe = await mountSelection();
    act(() => {
      probe.current?.click('a', click(true).event);
    });
    act(() => {
      probe.current?.click('b', click(true).event);
    });

    act(() => {
      probe.current?.forget(['a']);
    });
    expect(probe.current?.selected).toEqual(['b']);

    act(() => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    });
    expect(probe.current?.selected).toEqual([]);
  });
});
