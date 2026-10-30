import { afterEach, describe, expect, it } from 'vitest';
import type { SearchResult } from '../services/api/types';
import { fakeServices, mount, type Mounted } from '../test-support/services';
import { SearchResultCard } from './SearchResultCard';

let view: Mounted | null = null;
afterEach(() => {
  view?.unmount();
  view = null;
});

const row = (reason: string | null): SearchResult => ({
  kind: 'moment',
  photo_id: null,
  segment_id: 's1',
  clip_id: 'c1',
  start_s: 2,
  end_s: 9,
  thumb_url: null,
  reason,
  score: 0.5,
  clip_filename: 'dog.mp4',
  clip_title: 'Sleepy old dog',
  recorded_at: null,
  faces: [],
});

const card = (reason: string | null, isRefining: boolean) => (
  <ul>
    <SearchResultCard result={row(reason)} isSelecting={false} isPicked={false} isRefining={isRefining} now={new Date(0)} onOpen={() => undefined} onTogglePick={() => undefined} />
  </ul>
);

describe('SearchResultCard', () => {
  it('shows two grey lines instead of a reason while refining, keeping time and title', async () => {
    view = await mount(card(null, true), fakeServices());

    expect(view.container.querySelectorAll('.result-card__reason-pending .skeleton')).toHaveLength(2);
    expect(view.container.textContent).not.toContain('Matching moment');
    expect(view.container.textContent).toContain('0:02–0:09');
    expect(view.container.textContent).toContain('Sleepy old dog');
  });

  it('says "Matching moment" when no reason came and nothing is pending', async () => {
    view = await mount(card(null, false), fakeServices());

    expect(view.container.querySelector('.result-card__reason-pending')).toBeNull();
    expect(view.container.textContent).toContain('Matching moment');
  });

  it('shows a reason that is already there, even while refining', async () => {
    view = await mount(card('Dog naps on the couch', true), fakeServices());

    expect(view.container.querySelector('.result-card__reason-pending')).toBeNull();
    expect(view.container.textContent).toContain('Dog naps on the couch');
  });

  it('shows a photo with "Photo" in place of the time, its file and day, never a pick box', async () => {
    const photo: SearchResult = {
      ...row('A gold 60 on a flower wall'),
      kind: 'photo',
      photo_id: 'ph_4210',
      segment_id: 'photo:ph_4210',
      clip_id: '',
      start_s: 0,
      end_s: 0,
      clip_filename: '_MG_4210.JPG',
      clip_title: 'Flower backdrop',
      recorded_at: '2026-08-19T08:42:00Z',
    };
    const opened: SearchResult[] = [];
    view = await mount(
      <ul>
        <SearchResultCard result={photo} isSelecting isPicked={false} isRefining={false} now={new Date(0)} onOpen={(result) => opened.push(result)} onTogglePick={() => undefined} />
      </ul>,
      fakeServices(),
    );

    expect(view.container.querySelector('.result-card__time')?.textContent).toBe('Photo');
    expect(view.container.querySelector('.result-card__clip')?.textContent).toMatch(/^_MG_4210 · 19 Aug 2026$/);
    expect(view.container.querySelector('input[type="checkbox"]')).toBeNull();
    view.container.querySelector('button')?.click();
    expect(opened.map((result) => result.photo_id)).toEqual(['ph_4210']);
  });
});
