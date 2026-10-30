import { act } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { fakeServices, mount, type Mounted } from '../test-support/services';
import { Menu, type MenuEntry } from './Menu';

let view: Mounted | null = null;
afterEach(() => {
  view?.unmount();
  view = null;
});

const anchor = { kind: 'point' as const, point: { x: 10, y: 10 } };

function items(onMake = vi.fn(), onDelete = vi.fn()): MenuEntry[] {
  return [
    { kind: 'item', label: 'Make a short from this clip', onSelect: onMake },
    { kind: 'separator' },
    { kind: 'item', label: 'Delete clip…', isDanger: true, onSelect: onDelete },
  ];
}

describe('Menu', () => {
  it('renders nothing while closed', async () => {
    view = await mount(<Menu anchor={null} label="Clip actions" items={items()} onClose={vi.fn()} />, fakeServices());

    expect(view.container.querySelector('[role="menu"]')).toBeNull();
  });

  it('shows the items, the separator and a red delete, and focuses the first item', async () => {
    view = await mount(<Menu anchor={anchor} label="Clip actions" items={items()} onClose={vi.fn()} />, fakeServices());

    const menu = view.container.querySelector('[role="menu"]');
    expect(menu?.getAttribute('aria-label')).toBe('Clip actions');
    expect([...view.container.querySelectorAll('[role="menuitem"]')].map((item) => item.textContent)).toEqual([
      'Make a short from this clip',
      'Delete clip…',
    ]);
    expect(view.container.querySelectorAll('[role="separator"]')).toHaveLength(1);
    expect(view.container.querySelector('.menu__item--danger')?.textContent).toBe('Delete clip…');
    expect(document.activeElement?.textContent).toBe('Make a short from this clip');
  });

  it('closes, then runs the picked item', async () => {
    const order: string[] = [];
    const onDelete = vi.fn(() => order.push('select'));
    const onClose = vi.fn(() => order.push('close'));
    view = await mount(<Menu anchor={anchor} label="Clip actions" items={items(vi.fn(), onDelete)} onClose={onClose} />, fakeServices());

    act(() => {
      view?.container.querySelector<HTMLButtonElement>('.menu__item--danger')?.click();
    });

    expect(order).toEqual(['close', 'select']);
  });

  it('closes on Esc and on a press outside, but not on a press inside', async () => {
    const onClose = vi.fn();
    view = await mount(<Menu anchor={anchor} label="Clip actions" items={items()} onClose={onClose} />, fakeServices());
    const menu = view.container.querySelector('[role="menu"]');

    act(() => {
      menu?.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
    });
    expect(onClose).not.toHaveBeenCalled();

    act(() => {
      menu?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    });
    act(() => {
      document.body.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
    });
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it('moves focus with the arrow keys, skipping disabled items', async () => {
    const list: MenuEntry[] = [
      { kind: 'item', label: 'A', onSelect: vi.fn() },
      { kind: 'item', label: 'B', onSelect: vi.fn(), isDisabled: true },
      { kind: 'item', label: 'C', onSelect: vi.fn() },
    ];
    view = await mount(<Menu anchor={anchor} label="Actions" items={list} onClose={vi.fn()} />, fakeServices());
    const menu = view.container.querySelector('[role="menu"]');

    act(() => {
      menu?.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
    });
    expect(document.activeElement?.textContent).toBe('C');
    act(() => {
      menu?.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
    });
    expect(document.activeElement?.textContent).toBe('A');
  });

  it('opens a submenu of check items beside its row; a check closes the menu and runs', async () => {
    const onTrip = vi.fn();
    const onClose = vi.fn();
    const list: MenuEntry[] = [
      { kind: 'item', label: 'Show in Finder', hint: '⌘R', onSelect: vi.fn() },
      {
        kind: 'submenu',
        label: 'Add to segment',
        items: [
          { kind: 'check', label: '60th birthday', isChecked: true, onSelect: vi.fn(), swatchClass: 'swatch--orange' },
          { kind: 'check', label: 'Australia trip', isChecked: false, onSelect: onTrip },
        ],
      },
    ];
    view = await mount(<Menu anchor={anchor} label="Clip" items={list} onClose={onClose} />, fakeServices());
    const trigger = view.container.querySelector<HTMLButtonElement>('[aria-haspopup="menu"]');
    expect(view.container.querySelector('.menu__hint')?.textContent).toBe('⌘R');
    expect(trigger?.getAttribute('aria-expanded')).toBe('false');

    act(() => {
      trigger?.click();
    });
    const checks = [...view.container.querySelectorAll('[role="menuitemcheckbox"]')];
    expect(trigger?.getAttribute('aria-expanded')).toBe('true');
    expect(view.container.querySelector('.menu--sub')?.getAttribute('aria-label')).toBe('Add to segment');
    expect(checks.map((c) => [c.textContent, c.getAttribute('aria-checked')])).toEqual([
      ['60th birthday', 'true'],
      ['Australia trip', 'false'],
    ]);

    act(() => {
      (checks[1] as HTMLButtonElement).click();
    });
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onTrip).toHaveBeenCalledTimes(1);
  });
});
