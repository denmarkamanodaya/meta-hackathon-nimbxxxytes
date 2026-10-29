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

function click(metaKey: boolean, shiftKey = false) {
  const preventDefault = vi.fn();
  return { event: { metaKey, ctrlKey: false, shiftKey, preventDefault } as unknown as MouseEvent<HTMLElement>, preventDefault };
}

describe('useTileSelection', () => {
  it('toggles with ⌘-click; a plain click selects that clip alone; neither follows the link', async () => {
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
    expect(probe.current?.selected).toEqual(['c']);
    expect(plain.preventDefault).toHaveBeenCalled();
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

  it('in Select mode ticks with a plain click and a range with Shift, and leaving clears it', async () => {
    const probe = await mountSelection();
    const order = ['a', 'b', 'c', 'd'];

    act(() => {
      probe.current?.setSelecting(true);
    });
    act(() => {
      probe.current?.click('a', click(false).event, order);
      probe.current?.click('c', click(false).event, order);
    });
    expect(probe.current?.selected).toEqual(['a', 'c']);
    act(() => {
      probe.current?.click('a', click(false).event, order);
    });
    expect(probe.current?.selected).toEqual(['c']);
    act(() => {
      // The untick left the anchor on a: Shift-click b ticks a to b.
      probe.current?.click('b', click(false, true).event, order);
    });
    expect(probe.current?.selected).toEqual(['c', 'a', 'b']);
    expect(probe.current?.isSelecting).toBe(true);

    act(() => {
      probe.current?.setSelecting(false);
    });
    expect(probe.current?.isSelecting).toBe(false);
    expect(probe.current?.selected).toEqual([]);
  });

  it('a long press turns Select mode on with that clip ticked; a tap then toggles; Esc leaves', async () => {
    const probe = await mountSelection();

    act(() => {
      probe.current?.hold('b');
    });
    expect(probe.current?.isSelecting).toBe(true);
    expect(probe.current?.selected).toEqual(['b']);
    act(() => {
      probe.current?.toggle('d');
      probe.current?.toggle('b');
    });
    expect(probe.current?.selected).toEqual(['d']);

    act(() => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    });
    expect(probe.current?.isSelecting).toBe(false);
    expect(probe.current?.selected).toEqual([]);
  });
});
