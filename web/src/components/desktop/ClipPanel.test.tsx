// The keep actions' ⋯ menu: Open takes you to the clip from the Gallery, and is left out on the
// clip's own player page, where it would only reopen the page you are on.
import { act } from 'react';
import { MemoryRouter } from 'react-router';
import { afterEach, describe, expect, it } from 'vitest';
import { parseClipList } from '../../services/api/parse';
import type { ClipSummary } from '../../services/api/types';
import clipsJson from '../../test-support/fixtures/clips.json';
import { fakeServices, mount, type Mounted } from '../../test-support/services';
import { ClipMoreButton } from './ClipPanel';

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
