import { act } from 'react';
import { MemoryRouter, Route, Routes } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ShortPropsSchema, type ShortProps } from '@nimbytes/composition';
import sampleProps from '../../../render/fixtures/props.sample.json';
import type { ApiClient } from '../services/api/client';
import { fakeApi, fakeServices, mount, type Mounted } from '../test-support/services';
import { shortDetail, timelineV1, versionWith } from '../test-support/shorts';

/** The Player is a canvas of iframes in a browser; here it only records the props it gets. */
const playerProps: ShortProps[] = [];
vi.mock('@remotion/player', () => ({
  Player: (props: { inputProps: ShortProps }) => {
    playerProps.push(props.inputProps);
    return <div data-testid="player" />;
  },
}));

const { ShortPage } = await import('./ShortPage');

let view: Mounted | null = null;
afterEach(() => {
  view?.unmount();
  view = null;
  playerProps.length = 0;
});

/** Props whose clips match timelineV1 (s3, s7), as the api would build them. */
const base = ShortPropsSchema.parse(sampleProps);
const props: ShortProps = {
  ...base,
  clips: [
    { ...base.clips[0], segment_id: 's3', in_s: 12.6, out_s: 15.8, src_url: 'https://s3/p.mp4', punch_in: 1, subject: 'the latte art', captions: [] },
    { ...base.clips[0], segment_id: 's7', in_s: 40, out_s: 44, src_url: 'https://s3/q.mp4', punch_in: 1, subject: null, captions: [] },
  ],
};

async function open(getShort: ApiClient['getShort'], saveTimeline = vi.fn<ApiClient['saveTimeline']>()) {
  view = await mount(
    <MemoryRouter initialEntries={['/editor/sh1']}>
      <Routes>
        <Route path="/editor/:id" element={<ShortPage />} />
      </Routes>
    </MemoryRouter>,
    fakeServices({ api: fakeApi({ getShort, saveTimeline }) }),
  );
  return { saveTimeline };
}

describe('ShortPage Player', () => {
  it('feeds the Player the version’s composition props', async () => {
    const detail = { ...shortDetail(), versions: [{ ...versionWith(1, 35, timelineV1()), composition_props: props }] };

    await open(vi.fn<ApiClient['getShort']>().mockResolvedValue(detail));

    const last = playerProps.at(-1);
    expect(last?.clips.map((c) => [c.segment_id, c.src_url])).toEqual([
      ['s3', 'https://s3/p.mp4'],
      ['s7', 'https://s3/q.mp4'],
    ]);
  });

  it('updates the Player at once when a shot is removed, without saving', async () => {
    const detail = { ...shortDetail(), versions: [{ ...versionWith(1, 35, timelineV1()), composition_props: props }] };
    const getShort = vi.fn<ApiClient['getShort']>().mockResolvedValue(detail);
    const { saveTimeline } = await open(getShort);

    const remove = [...(view?.container.querySelectorAll('button') ?? [])].find((b) => b.textContent.includes('Remove'));
    act(() => {
      remove?.click();
    });

    expect(playerProps.at(-1)?.clips.map((c) => c.segment_id)).toEqual(['s7']);
    expect(saveTimeline).not.toHaveBeenCalled();
    expect(getShort).toHaveBeenCalledTimes(1);
  });

  it('falls back to the preview video when a version has no composition props', async () => {
    const detail = { ...shortDetail(), versions: [versionWith(1, 35)] };

    await open(vi.fn<ApiClient['getShort']>().mockResolvedValue(detail));

    expect(playerProps).toEqual([]);
    expect(view?.container.querySelector('video')).not.toBeNull();
  });
});
