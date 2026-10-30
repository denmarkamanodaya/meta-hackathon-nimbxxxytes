// The keep actions' ⋯ menu: Open takes you to the clip from the Gallery, and is left out on the
// clip's own player page, where it would only reopen the page you are on. Show in Finder for the
// other kinds reveals their Library file, in the Mac app only.
import { act } from 'react';
import { MemoryRouter } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { documentItem } from '../../core/gallery-items';
import type { DesktopBridge } from '../../core/ports/desktop-bridge';
import { parseDocumentList } from '../../services/api/parse-documents';
import documentsJson from '../../test-support/fixtures/documents.json';
import { parseClipList } from '../../services/api/parse';
import type { ClipSummary } from '../../services/api/types';
import clipsJson from '../../test-support/fixtures/clips.json';
import { fakeServices, mount, type Mounted } from '../../test-support/services';
import { ClipMoreButton, ShowItemInFinderButton } from './ClipPanel';

let view: Mounted | null = null;
afterEach(() => {
  view?.unmount();
  view = null;
});

const first = parseClipList(clipsJson)?.[0];
if (first === undefined) throw new Error('clips fixture does not parse');
const CLIP: ClipSummary = first;

async function menuLabels(path: string) {
  view = await mount(
    <MemoryRouter initialEntries={[path]}>
      <ClipMoreButton clip={CLIP} />
    </MemoryRouter>,
    fakeServices(),
  );
  const more = view.container.querySelector<HTMLButtonElement>('[aria-label="More"]');
  act(() => {
    more?.click();
  });
  return [...view.container.querySelectorAll('[role="menuitem"]')].map((item) => item.querySelector('.menu__label')?.textContent ?? '');
}

describe('the clip ⋯ menu', () => {
  it('offers Open from the Gallery', async () => {
    const labels = await menuLabels('/');

    expect(labels).toEqual(['Open', 'Delete…']);
  });

  it('leaves Open out on the clip’s own page', async () => {
    const labels = await menuLabels(`/clips/${encodeURIComponent(CLIP.clip_id)}`);

    expect(labels).toEqual(['Delete…']);
  });
});

describe('Show in Finder for a document', () => {
  const water = parseDocumentList(documentsJson)?.[0];
  if (water === undefined) throw new Error('documents fixture does not parse');
  const finder = (root: HTMLElement) => [...root.querySelectorAll('button')].find((button) => button.textContent === 'Show in Finder');

  it('reveals its Library file by its Gallery id in the Mac app', async () => {
    const reveal = vi.fn<DesktopBridge['reveal']>().mockResolvedValue(undefined);
    view = await mount(<ShowItemInFinderButton item={documentItem(water)} />, fakeServices({ desktop: { reveal } as unknown as DesktopBridge }));
    act(() => {
      finder(view?.container ?? document.body)?.click();
    });

    expect(reveal).toHaveBeenCalledWith({ kind: 'item', itemId: 'doc:doc_water' });
  });

  it('is left out in a browser', async () => {
    view = await mount(<ShowItemInFinderButton item={documentItem(water)} />, fakeServices());

    expect(finder(view.container)).toBeUndefined();
  });
});
