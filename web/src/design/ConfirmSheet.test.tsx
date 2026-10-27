import { act } from 'react';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { fakeServices, mount, type Mounted } from '../test-support/services';
import { ConfirmSheet } from './ConfirmSheet';

// jsdom has no modal dialogs; open and close just set the attribute.
const dialog = HTMLDialogElement.prototype;
const real = { showModal: Object.getOwnPropertyDescriptor(dialog, 'showModal'), close: Object.getOwnPropertyDescriptor(dialog, 'close') };
beforeAll(() => {
  dialog.showModal = function showModal(this: HTMLDialogElement) {
    this.setAttribute('open', '');
  };
  dialog.close = function close(this: HTMLDialogElement) {
    this.removeAttribute('open');
  };
});
afterAll(() => {
  for (const [name, descriptor] of Object.entries(real)) {
    if (descriptor === undefined) Reflect.deleteProperty(dialog, name);
    else Object.defineProperty(dialog, name, descriptor);
  }
});

let view: Mounted | null = null;
afterEach(() => {
  view?.unmount();
  view = null;
});

const sheet = (isBusy: boolean, onConfirm = vi.fn(), onCancel = vi.fn()) => (
  <ConfirmSheet
    open
    title="Delete this short?"
    body="Its drafts and render are removed. The clips it used stay."
    confirmLabel="Delete short"
    busyLabel="Deleting…"
    isBusy={isBusy}
    onConfirm={onConfirm}
    onCancel={onCancel}
  />
);

const buttons = (root: HTMLElement) => [...root.querySelectorAll<HTMLButtonElement>('.confirm-sheet__actions button')];

describe('ConfirmSheet', () => {
  it('shows the question, the body, a red confirm and Cancel (no Close)', async () => {
    view = await mount(sheet(false), fakeServices());

    expect(view.container.querySelector('.sheet__title')?.textContent).toBe('Delete this short?');
    expect(view.container.querySelector('.confirm-sheet__body')?.textContent).toBe('Its drafts and render are removed. The clips it used stay.');
    expect(buttons(view.container).map((b) => [b.textContent, b.className.includes('button--danger')])).toEqual([
      ['Delete short', true],
      ['Cancel', false],
    ]);
    expect(view.container.textContent).not.toContain('Close');
    expect(document.activeElement?.textContent).toBe('Cancel');
  });

  it('confirms and cancels through its callbacks', async () => {
    const onConfirm = vi.fn();
    const onCancel = vi.fn();
    view = await mount(sheet(false, onConfirm, onCancel), fakeServices());

    act(() => {
      buttons(view?.container as HTMLElement)[0]?.click();
    });
    act(() => {
      buttons(view?.container as HTMLElement)[1]?.click();
    });

    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it('disables both buttons and says what it is doing while busy', async () => {
    view = await mount(sheet(true), fakeServices());

    expect(buttons(view.container).map((b) => [b.textContent, b.disabled])).toEqual([
      ['Deleting…', true],
      ['Cancel', true],
    ]);
  });
});
