// Rename a guide, both apps: the Mac header's ⋯ lists Rename guide… above Delete guide…, a Guides
// list row opens the same menu on right-click (never the webview's), and the phone's Rename text
// button opens the rename sheet. Each saves the trimmed title once and reloads what shows it.
import { act } from 'react';
import { MemoryRouter, Route, Routes } from 'react-router';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { MacGuideOptions } from '../components/desktop/MacGuideOptions';
import type { ApiClient } from '../services/api/client';
import { parseGuide, parseGuideList } from '../services/api/parse-guides';
import type { Guide, GuideSummary } from '../services/api/types';
import guideJson from '../test-support/fixtures/guide.json';
import guidesJson from '../test-support/fixtures/guides.json';
import { fakeApi, fakeServices, mount, type Mounted } from '../test-support/services';
import { MacGuidesPage } from './desktop/MacGuidesPage';
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
const rows = parseGuideList(guidesJson);
if (parsed === null || rows === null) throw new Error('guide fixtures do not parse');
const GUIDE: Guide = parsed;
const ROWS: GuideSummary[] = rows;

const menuItems = (container: HTMLElement) => [...container.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')];

async function click(button: HTMLButtonElement | undefined) {
  if (button === undefined) throw new Error('button not found');
  await act(async () => {
    button.click();
    await Promise.resolve();
  });
}

async function type(container: HTMLElement, text: string) {
  const field = container.querySelector<HTMLInputElement>('dialog[open] input');
  if (field === null) throw new Error('no field in the open dialog');
  await act(async () => {
    // React tracks the value it set; the prototype's setter writes past that, like typing does.
    Reflect.set(HTMLInputElement.prototype, 'value', text, field);
    field.dispatchEvent(new Event('input', { bubbles: true }));
    await Promise.resolve();
  });
}

async function submit(container: HTMLElement) {
  await act(async () => {
    container.querySelector<HTMLFormElement>('dialog[open] form')?.requestSubmit();
    await Promise.resolve();
    await Promise.resolve();
  });
}

function routed(path: string, element: React.ReactNode) {
  return (
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/guides/:id" element={element} />
        <Route path="/guides" element={element} />
      </Routes>
    </MemoryRouter>
  );
}

describe('Rename guide on the Mac guide page', () => {
  it('lists Rename guide… above Delete guide…, saves the trimmed title and reloads', async () => {
    const renameGuide = vi.fn<ApiClient['renameGuide']>().mockResolvedValue({ ...GUIDE, title: 'Tea, the quick way' });
    const onRenamed = vi.fn();
    view = await mount(
      routed('/guides/g_kettle', <MacGuideOptions guide={{ guideId: 'g_kettle', title: GUIDE.title }} onRenamed={onRenamed} />),
      fakeServices({ api: fakeApi({ renameGuide }) }),
    );

    await click(view.container.querySelector<HTMLButtonElement>('[aria-haspopup="menu"]') ?? undefined);
    expect(menuItems(view.container).map((b) => b.textContent)).toEqual(['Rename iGuide…', 'Delete iGuide…']);
    await click(menuItems(view.container)[0]);
    expect(view.container.querySelector('dialog[open] h2')?.textContent).toBe('Rename iGuide');
    expect(view.container.querySelector<HTMLInputElement>('dialog[open] input')?.value).toBe(GUIDE.title);

    await type(view.container, '  Tea, the quick way  ');
    await submit(view.container);

    expect(renameGuide.mock.calls).toEqual([['g_kettle', 'Tea, the quick way']]);
    expect(onRenamed).toHaveBeenCalledTimes(1);
    expect(view.container.querySelector('dialog[open]')).toBeNull();
  });

  it('keeps Rename off and says why for a title past 60 characters', async () => {
    const renameGuide = vi.fn<ApiClient['renameGuide']>();
    view = await mount(
      routed('/guides/g_kettle', <MacGuideOptions guide={{ guideId: 'g_kettle', title: GUIDE.title }} onRenamed={vi.fn()} />),
      fakeServices({ api: fakeApi({ renameGuide }) }),
    );
    await click(view.container.querySelector<HTMLButtonElement>('[aria-haspopup="menu"]') ?? undefined);
    await click(menuItems(view.container)[0]);

    await type(view.container, 'x'.repeat(61));
    await submit(view.container);

    expect(view.container.querySelector('dialog[open] [role="alert"]')?.textContent).toBe('Use 60 characters or fewer.');
    expect(renameGuide).not.toHaveBeenCalled();
  });
});

describe('Guides list on the Mac: right-click', () => {
  async function shownList(renameGuide = vi.fn<ApiClient['renameGuide']>().mockResolvedValue(GUIDE)) {
    const listGuides = vi.fn<ApiClient['listGuides']>().mockResolvedValue(ROWS);
    const getGuide = vi.fn<ApiClient['getGuide']>().mockResolvedValue(GUIDE);
    view = await mount(routed('/guides', <MacGuidesPage />), fakeServices({ api: fakeApi({ listGuides, getGuide, renameGuide }) }));
    await act(async () => {
      await Promise.resolve();
    });
    return { listGuides, renameGuide };
  }

  const rowNamed = (container: HTMLElement, title: string) =>
    [...container.querySelectorAll('li')].find((li) => li.querySelector('.mac-guides__title')?.textContent === title);

  function rightClick(target: Element | undefined) {
    if (target === undefined) throw new Error('row not found');
    const event = new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 40, clientY: 60 });
    act(() => {
      target.dispatchEvent(event);
    });
    return event;
  }

  it('opens Rename guide… / Delete guide… in place of the webview menu and renames from it', async () => {
    const { listGuides, renameGuide } = await shownList();
    const calls = listGuides.mock.calls.length;

    const event = rightClick(rowNamed(view?.container ?? document.body, 'Kettle: a cup of tea')?.querySelector('button') ?? undefined);

    expect(event.defaultPrevented).toBe(true);
    const container = view?.container ?? document.body;
    expect(menuItems(container).map((b) => b.textContent)).toEqual(['Rename iGuide…', 'Delete iGuide…']);
    await click(menuItems(container)[0]);
    await type(container, 'Tea, the quick way');
    await submit(container);

    expect(renameGuide.mock.calls).toEqual([['g_kettle', 'Tea, the quick way']]);
    expect(listGuides.mock.calls.length).toBeGreaterThan(calls);
  });

  it('opens no menu on a guide still being made, and still keeps the webview menu away', async () => {
    await shownList();

    const event = rightClick(rowNamed(view?.container ?? document.body, 'Front door: lock up'));

    expect(event.defaultPrevented).toBe(true);
    expect(menuItems(view?.container ?? document.body)).toEqual([]);
  });
});

describe('Rename on the phone guide page', () => {
  it('opens the rename sheet from the Rename text button, saves the trimmed title and reloads', async () => {
    const getGuide = vi.fn<ApiClient['getGuide']>().mockResolvedValue(GUIDE);
    const renameGuide = vi.fn<ApiClient['renameGuide']>().mockResolvedValue({ ...GUIDE, title: 'Tea, the quick way' });
    view = await mount(routed('/guides/g_kettle', <GuidePage />), fakeServices({ api: fakeApi({ getGuide, renameGuide }) }));
    await act(async () => {
      await Promise.resolve();
    });
    const loads = getGuide.mock.calls.length;

    await click([...view.container.querySelectorAll<HTMLButtonElement>('.back-header button')].find((b) => b.textContent === 'Rename'));
    expect(view.container.querySelector<HTMLInputElement>('dialog[open] input')?.value).toBe(GUIDE.title);

    await type(view.container, ' ');
    expect(view.container.querySelector('dialog[open] [role="alert"]')?.textContent).toBe('Give the iGuide a title.');
    expect(view.container.querySelector<HTMLButtonElement>('dialog[open] button[type="submit"]')?.disabled).toBe(true);

    await type(view.container, ' Tea, the quick way ');
    await submit(view.container);

    expect(renameGuide.mock.calls).toEqual([['g_kettle', 'Tea, the quick way']]);
    expect(getGuide.mock.calls.length).toBeGreaterThan(loads);
    expect(view.container.querySelector('dialog[open]')).toBeNull();
  });
});
