// The right column's near-copy and same-moment boxes (Phase 29 V52–V53): the copy box words, Keep
// both and Remove this copy (only after the confirm), and the angles box with its linked clips.
import { act } from 'react';
import { MemoryRouter } from 'react-router';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type { ApiClient } from '../../services/api/client';
import type { ClipDetail, ClipLink, ClipSummary } from '../../services/api/types';
import { fakeApi, fakeServices, mount, type Mounted } from '../../test-support/services';
import { ClipSimilarSection } from './ClipPanel';

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

const CLIP: ClipSummary = {
  clip_id: 'export',
  title: 'Beach walk (export)',
  filename: 'export.mp4',
  duration_s: 58,
  recorded_at: '2026-10-20T10:00:00Z',
  status: 'near_copy',
  thumb_url: null,
  segment_count: 7,
  people: [],
  duplicate_of: null,
  near_copy_of: { clip_id: 'samui', title: 'Beach walk, Koh Samui', score: 0.94 },
  angles: 0,
  size_bytes: 600_000_000,
  project_ids: [],
  speech_count: 0,
  face_count: 0,
};

const ORIGINAL: ClipLink = {
  clip_id: 'samui',
  title: 'Beach walk, Koh Samui',
  kind: 'near_copy_of',
  score: 0.94,
  recorded_at: '2026-10-20T10:00:00Z',
  thumb_url: null,
  duration_s: 108,
};

const detailOf = (clip: ClipSummary, links: ClipLink[]): ClipDetail => ({ clip, proxy_url: null, segments: [], turns: [], speakers: [], tracks: [], links });

const buttonNamed = (text: string) => [...document.querySelectorAll('button')].find((button) => button.textContent === text);

async function show(clip: ClipSummary, links: ClipLink[], api: Partial<ApiClient> = {}) {
  const onKept = vi.fn();
  const onRemoved = vi.fn();
  view = await mount(
    <MemoryRouter>
      <ClipSimilarSection clip={clip} detail={detailOf(clip, links)} onKept={onKept} onRemoved={onRemoved} />
    </MemoryRouter>,
    fakeServices({ api: fakeApi(api) }),
  );
  return { onKept, onRemoved, container: view.container };
}

describe('the copy box', () => {
  it('says how alike, names the original (it opens it), hints at the trim and the not-searched rule', async () => {
    const { container } = await show(CLIP, [ORIGINAL]);

    expect(container.querySelector('.similar-box__body')?.textContent).toBe(
      '94% the same as Beach walk, Koh Samui (1:48), filmed 20 Oct. This one is shorter: it looks trimmed.',
    );
    expect(container.querySelector('.similar-box__original')?.getAttribute('href')).toBe('/clips/samui');
    expect(container.textContent).toContain('no AI runs on them until you keep them');
  });

  it('Keep both calls keep and reloads', async () => {
    const keepClip = vi.fn<ApiClient['keepClip']>().mockResolvedValue({ clip_id: 'export', status: 'processing' });
    const { onKept } = await show(CLIP, [ORIGINAL], { keepClip });

    await act(async () => {
      buttonNamed('Keep both')?.click();
      await Promise.resolve();
    });

    expect(keepClip).toHaveBeenCalledWith('export');
    expect(onKept).toHaveBeenCalledOnce();
  });

  it('Remove this copy deletes only after the confirm', async () => {
    const deleteClip = vi.fn<ApiClient['deleteClip']>().mockResolvedValue(true);
    const { onRemoved } = await show(CLIP, [ORIGINAL], { deleteClip });

    act(() => {
      buttonNamed('Remove this copy')?.click();
    });
    expect(deleteClip).not.toHaveBeenCalled();
    await act(async () => {
      buttonNamed('Remove copy')?.click();
      await Promise.resolve();
    });

    expect(deleteClip).toHaveBeenCalledWith('export');
    expect(onRemoved).toHaveBeenCalledOnce();
  });

  it('shows the box for a ready clip the backfill linked, without the not-searched line', async () => {
    const { container } = await show({ ...CLIP, status: 'ready' }, [ORIGINAL]);

    expect(container.querySelector('.similar-box--copy')).not.toBeNull();
    expect(container.textContent).not.toContain('no AI runs');
  });
});

describe('the angles box and plain clips', () => {
  it('lists this clip and the other angle (which opens), and how far apart', async () => {
    const here: ClipSummary = { ...CLIP, clip_id: 'glass', title: 'Sunset from the pier', status: 'ready', near_copy_of: null, angles: 1, recorded_at: '2026-10-20T18:12:00Z', duration_s: 52 };
    const phone: ClipLink = { ...ORIGINAL, clip_id: 'phone', title: 'Pier sunset (phone)', kind: 'same_moment', recorded_at: '2026-10-20T18:12:40Z', duration_s: 65 };
    const { container } = await show(here, [phone]);

    expect(container.querySelector('.similar-box__title')?.textContent).toBe('2 angles of this moment');
    expect(container.textContent).toContain('Also filmed on another device, 40 seconds apart.');
    expect([...container.querySelectorAll('a.similar-box__angle')].map((a) => a.getAttribute('href'))).toEqual(['/clips/phone']);
    expect(container.querySelector('[aria-current="true"]')?.textContent).toContain('Sunset from the pier');
  });

  it('shows nothing for a plain clip, and "1 copy of this clip" on an original', async () => {
    const plain: ClipSummary = { ...CLIP, status: 'ready', near_copy_of: null };
    const first = await show(plain, []);
    expect(first.container.innerHTML).toBe('');
    view?.unmount();

    const { container } = await show(plain, [{ ...ORIGINAL, kind: 'copied_by' }]);
    expect(container.textContent).toBe('1 copy of this clip');
  });
});
