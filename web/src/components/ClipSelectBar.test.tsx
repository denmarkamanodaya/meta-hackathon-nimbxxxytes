import { act } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { fakeServices, mount, type Mounted } from '../test-support/services';
import { ClipSelectBar } from './ClipSelectBar';

let view: Mounted | null = null;
afterEach(() => {
  view?.unmount();
  view = null;
});

async function shown(count: number, canMakeShort: boolean) {
  const onMakeShort = vi.fn();
  const onCancel = vi.fn();
  view = await mount(
    <ClipSelectBar place="column" count={count} canMakeShort={canMakeShort} onMakeShort={onMakeShort} onCancel={onCancel} />,
    fakeServices(),
  );
  const root = view.container;
  const [make, cancel] = [...root.querySelectorAll('button')];
  if (make === undefined || cancel === undefined) throw new Error('the bar has two buttons');
  return { root, make, cancel, onMakeShort, onCancel };
}

describe('ClipSelectBar', () => {
  it('says how many clips are selected, then Make a short and Cancel', async () => {
    const { root, make, cancel } = await shown(3, true);

    expect(root.querySelector('[role="status"]')?.textContent).toBe('3 clips selected');
    expect([make.textContent, cancel.textContent]).toEqual(['Make a short', 'Cancel']);
    expect(root.querySelector('[role="region"]')?.getAttribute('aria-label')).toBe('Selected clips');
  });

  it('makes a short on Make a short and leaves on Cancel', async () => {
    const { make, cancel, onMakeShort, onCancel } = await shown(2, true);

    act(() => {
      make.click();
      cancel.click();
    });

    expect(onMakeShort).toHaveBeenCalledTimes(1);
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it('keeps Make a short off while no selected clip has moments, and Cancel on', async () => {
    const { root, make, cancel, onMakeShort } = await shown(0, false);

    act(() => {
      make.click();
    });

    expect(root.querySelector('[role="status"]')?.textContent).toBe('0 clips selected');
    expect(make.disabled).toBe(true);
    expect(cancel.disabled).toBe(false);
    expect(onMakeShort).not.toHaveBeenCalled();
  });

  it('offers Add to segment only when the page gives it, and opens its menu', async () => {
    const onAddToProject = vi.fn();
    view = await mount(
      <ClipSelectBar place="column" count={2} canMakeShort onMakeShort={vi.fn()} onAddToProject={onAddToProject} onCancel={vi.fn()} />,
      fakeServices(),
    );
    const buttons = [...view.container.querySelectorAll('button')];

    expect(buttons.map((button) => button.textContent)).toEqual(['Add to segment', 'Make a short', 'Cancel']);
    act(() => {
      buttons[0]?.click();
    });
    expect(onAddToProject).toHaveBeenCalledTimes(1);
  });
});
