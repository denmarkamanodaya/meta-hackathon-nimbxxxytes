// Delete guide, both apps: the phone's text button and the Mac header's ⋯ ask first, Cancel keeps
// the guide, the confirm sends DELETE /guides/{id} and opens /guides; a failure stays and toasts.
import { act } from 'react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { MacGuideOptions } from '../components/desktop/MacGuideOptions';
import { ApiError, type ApiClient } from '../services/api/client';
import { parseGuide } from '../services/api/parse-guides';
import { ERROR, type Guide } from '../services/api/types';
import guideJson from '../test-support/fixtures/guide.json';
import { fakeApi, fakeServices, mount, type Mounted } from '../test-support/services';
import { GuidePage } from './GuidePage';

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

const parsed = parseGuide(guideJson);
if (parsed === null) throw new Error('guide.json does not parse');
const GUIDE: Guide = parsed;

function Where() {
  return <output data-testid="where">{useLocation().pathname}</output>;
}

const at = (container: HTMLElement) => container.querySelector('[data-testid="where"]')?.textContent;

const buttonNamed = (container: HTMLElement, text: string) =>
  [...container.querySelectorAll<HTMLButtonElement>('button')].find((b) => b.textContent === text);

async function click(button: HTMLButtonElement | undefined) {
  if (button === undefined) throw new Error('button not found');
  await act(async () => {
    button.click();
    await Promise.resolve();
  });
}

function routed(element: React.ReactNode) {
  return (
    <MemoryRouter initialEntries={['/guides/g_kettle']}>
      <Routes>
        <Route path="/guides/:id" element={element} />
        <Route path="/guides" element={<p>Guides list</p>} />
      </Routes>
      <Where />
    </MemoryRouter>
  );
}

describe('Delete guide on the phone', () => {
  it('asks first, keeps the guide on Cancel, then deletes it and opens the Guides list', async () => {
    const deleteGuide = vi.fn<ApiClient['deleteGuide']>().mockResolvedValue(true);
    const api = fakeApi({ getGuide: vi.fn<ApiClient['getGuide']>().mockResolvedValue(GUIDE), deleteGuide });
    view = await mount(routed(<GuidePage />), fakeServices({ api }));
    await act(async () => {
      await Promise.resolve();
    });

    await click(buttonNamed(view.container, 'Delete guide'));
    const sheet = view.container.querySelector('dialog[open]');
    expect(sheet?.textContent).toContain('Delete guide?');
    expect(sheet?.textContent).toContain('The steps, pictures and voice are removed. The clip stays in your library.');

    await click(buttonNamed(view.container, 'Cancel'));
    expect(deleteGuide).not.toHaveBeenCalled();
    expect(view.container.querySelector('dialog[open]')).toBeNull();

    await click(buttonNamed(view.container, 'Delete guide'));
    const confirm = [...view.container.querySelectorAll<HTMLButtonElement>('dialog[open] button')].find((b) => b.textContent === 'Delete guide');
    await click(confirm);

    expect(deleteGuide).toHaveBeenCalledWith('g_kettle');
    expect(at(view.container)).toBe('/guides');
  });

  it('shows no Delete while the guide is still being made', async () => {
    const api = fakeApi({ getGuide: vi.fn<ApiClient['getGuide']>().mockResolvedValue({ ...GUIDE, status: 'running', stage: 'frames', steps: [] }) });
    view = await mount(routed(<GuidePage />), fakeServices({ api }));
    await act(async () => {
      await Promise.resolve();
    });

    expect(buttonNamed(view.container, 'Delete guide')).toBeUndefined();
  });
});

describe('Delete guide on the Mac', () => {
  it('opens Delete guide… from ⋯, confirms in the red dialog and opens the Guides list', async () => {
    const deleteGuide = vi.fn<ApiClient['deleteGuide']>().mockResolvedValue(true);
    view = await mount(routed(<MacGuideOptions guide={{ guideId: 'g_kettle', title: GUIDE.title }} onRenamed={vi.fn()} />), fakeServices({ api: fakeApi({ deleteGuide }) }));

    await click(view.container.querySelector<HTMLButtonElement>('[aria-haspopup="menu"]') ?? undefined);
    await click([...view.container.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')].find((b) => b.textContent === 'Delete guide…'));
    expect(view.container.querySelector('dialog[open]')?.textContent).toContain('Delete guide?');
    await click(view.container.querySelector<HTMLButtonElement>('dialog[open] .mac-confirm__danger') ?? undefined);

    expect(deleteGuide).toHaveBeenCalledWith('g_kettle');
    expect(at(view.container)).toBe('/guides');
  });

  it('stays on the guide and raises a toast when the delete fails', async () => {
    const deleteGuide = vi.fn<ApiClient['deleteGuide']>().mockRejectedValue(new ApiError(ERROR.FORBIDDEN, 'Not your guide', 403));
    const services = fakeServices({ api: fakeApi({ deleteGuide }) });
    view = await mount(routed(<MacGuideOptions guide={{ guideId: 'g_kettle', title: GUIDE.title }} onRenamed={vi.fn()} />), services);

    await click(view.container.querySelector<HTMLButtonElement>('[aria-haspopup="menu"]') ?? undefined);
    await click([...view.container.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')].find((b) => b.textContent === 'Delete guide…'));
    await click(view.container.querySelector<HTMLButtonElement>('dialog[open] .mac-confirm__danger') ?? undefined);

    expect(at(view.container)).toBe('/guides/g_kettle');
    expect(services.toasts.getSnapshot().map((t) => t.title)).toEqual(['Could not delete the guide']);
  });
});
