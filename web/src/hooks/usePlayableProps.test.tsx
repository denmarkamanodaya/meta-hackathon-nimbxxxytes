import { act, useEffect } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ShortProps } from '@nimbytes/composition';
import sampleProps from '../../../render/fixtures/props.sample.json';
import type { MediaResolver } from '../core/ports/media-resolver';
import type { ShortSegment } from '../services/api/types';
import { fakeServices, mount, type Mounted } from '../test-support/services';
import { usePlayableProps } from './usePlayableProps';
import { readPlayerProps } from './usePlayerProps';

let view: Mounted | null = null;
afterEach(() => {
  results.length = 0;
  view?.unmount();
  view = null;
});

function sample(): ShortProps {
  const parsed = readPlayerProps(sampleProps);
  if (parsed === null) throw new Error('render/fixtures/props.sample.json no longer parses');
  return parsed;
}
const props = sample();
const segment = (segment_id: string, clip_id: string): ShortSegment => ({
  segment_id,
  clip_id,
  start_s: 0,
  end_s: 1,
  thumb_url: null,
  description: null,
});
const segments = props.clips.map((clip, i) => segment(clip.segment_id, `clip_${String(i)}`));

const results: (ShortProps | null)[] = [];
function Probe({ input }: { input: ShortProps | null }) {
  const result = usePlayableProps(input, segments);
  useEffect(() => {
    results.push(result);
  });
  return null;
}
const latest = () => results[results.length - 1];

describe('usePlayableProps', () => {
  it('returns the same props object in the PWA', async () => {
    view = await mount(<Probe input={props} />, fakeServices());
    await act(async () => {
      await Promise.resolve();
    });

    expect(latest()).toBe(props);
  });

  it('in the Mac app waits for the lookups, then swaps synced shots to local URLs only', async () => {
    const resolve = vi.fn<MediaResolver['resolve']>(({ id, cloudUrl }) =>
      Promise.resolve(id === 'clip_0' ? 'asset://localhost/kitchen.mp4' : cloudUrl),
    );
    const media: MediaResolver = { immediate: () => null, resolve };
    view = await mount(<Probe input={props} />, fakeServices({ media }));
    await act(async () => {
      await Promise.resolve();
    });

    expect(resolve.mock.calls.map(([ref]) => ref)).toEqual(
      props.clips.map((clip, i) => ({ kind: 'proxy', id: `clip_${String(i)}`, cloudUrl: clip.src_url })),
    );
    expect(latest()?.clips.map((clip) => clip.src_url)).toEqual([
      'asset://localhost/kitchen.mp4',
      ...props.clips.slice(1).map((clip) => clip.src_url),
    ]);
  });

  it('does not look a clip up again when the draft changes', async () => {
    const resolve = vi.fn<MediaResolver['resolve']>(({ cloudUrl }) => Promise.resolve(cloudUrl));
    view = await mount(<Probe input={props} />, fakeServices({ media: { immediate: () => null, resolve } }));
    await act(async () => {
      await Promise.resolve();
    });

    view.rerender(<Probe input={{ ...props, clips: props.clips.slice(1) }} />);
    await act(async () => {
      await Promise.resolve();
    });

    expect(resolve).toHaveBeenCalledTimes(props.clips.length);
    expect(latest()?.clips).toHaveLength(props.clips.length - 1);
  });

  it('shows no Player while a Mac app lookup is still running', async () => {
    const media: MediaResolver = { immediate: () => null, resolve: () => new Promise(() => undefined) };
    view = await mount(<Probe input={props} />, fakeServices({ media }));

    expect(latest()).toBeNull();
  });
});
