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
    <SearchResultCard result={row(reason)} isPicked={false} isRefining={isRefining} now={new Date(0)} onOpen={() => undefined} onTogglePick={() => undefined} />
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
});
