import { act } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { productionTitleProblem } from '../../core/production-view';
import { fakeServices, mount, type Mounted } from '../../test-support/services';
import { RenameForm } from './RenameForm';

let view: Mounted | null = null;
afterEach(() => {
  view?.unmount();
  view = null;
});

async function shown(onSave = vi.fn<(value: string) => Promise<boolean>>().mockResolvedValue(true), onClose = vi.fn()) {
  view = await mount(
    <RenameForm
      heading="Rename production"
      label="Title"
      initial="Beach day"
      problemOf={productionTitleProblem}
      isSaving={false}
      onSave={onSave}
      onClose={onClose}
    />,
    fakeServices(),
  );
  const root = view.container;
  const field = root.querySelector('input');
  const [cancel, save] = [...root.querySelectorAll('button')];
  if (field === null || cancel === undefined || save === undefined) throw new Error('the form has a field and two buttons');
  return { root, field, cancel, save, onSave, onClose };
}

async function type(field: HTMLInputElement, text: string) {
  await act(async () => {
    // React tracks the value it set; the prototype's setter writes past that, like typing does.
    Reflect.set(HTMLInputElement.prototype, 'value', text, field);
    field.dispatchEvent(new Event('input', { bubbles: true }));
    await Promise.resolve();
  });
}

async function submit(root: HTMLElement) {
  await act(async () => {
    root.querySelector('form')?.requestSubmit();
    await Promise.resolve();
  });
}

describe('RenameForm', () => {
  it('shows the heading, the field with the current value, and Rename off while unchanged', async () => {
    const { root, field, cancel, save } = await shown();

    expect(root.querySelector('h2')?.textContent).toBe('Rename production');
    expect(root.querySelector('label')?.textContent).toContain('Title');
    expect(field.value).toBe('Beach day');
    expect([cancel.textContent, save.textContent]).toEqual(['Cancel', 'Rename']);
    expect(save.disabled).toBe(true);
  });

  it('saves the trimmed value on ⏎ and closes once it is stored', async () => {
    const { root, field, save, onSave, onClose } = await shown();

    await type(field, '  Night walk  ');
    expect(save.disabled).toBe(false);
    await submit(root);

    expect(onSave.mock.calls).toEqual([['Night walk']]);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('keeps the sheet open when the save fails', async () => {
    const { root, field, onClose } = await shown(vi.fn<(value: string) => Promise<boolean>>().mockResolvedValue(false));

    await type(field, 'Night walk');
    await submit(root);

    expect(onClose).not.toHaveBeenCalled();
  });

  it('turns Rename off and says why for an empty value, and never saves it', async () => {
    const { root, field, save, onSave } = await shown();

    await type(field, '   ');
    expect(save.disabled).toBe(true);
    expect(field.getAttribute('aria-invalid')).toBe('true');
    expect(root.querySelector('[role="alert"]')?.textContent).toBe('Give the production a title.');
    await submit(root);

    expect(onSave).not.toHaveBeenCalled();
  });

  it('closes on Cancel without saving', async () => {
    const { cancel, onSave, onClose } = await shown();

    await act(async () => {
      cancel.click();
      await Promise.resolve();
    });

    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onSave).not.toHaveBeenCalled();
  });
});
