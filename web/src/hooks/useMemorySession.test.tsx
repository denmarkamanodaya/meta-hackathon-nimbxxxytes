// The session player reads each moment's line aloud and plays its stretch of video from the tap or
// key that moved it: Begin starts moment 1, Next moves on and hides the names, Again replays the
// same moment, reveal shows the names, and Next after the last moment ends the session quietly.
import { act, useEffect } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';
import type { MemoryMoment } from '../services/api/types';
import { fakeSpeaker } from '../test-support/fake-speaker';
import { fakeServices, mount, type Mounted } from '../test-support/services';
import { useMemorySession, type MemorySession } from './useMemorySession';

let view: Mounted | null = null;
let videoPlay: MockInstance<HTMLMediaElement['play']>;
let videoPause: MockInstance<HTMLMediaElement['pause']>;

beforeEach(() => {
  videoPlay = vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined);
  videoPause = vi.spyOn(HTMLMediaElement.prototype, 'pause').mockReturnValue(undefined);
});

afterEach(() => {
  view?.unmount();
  view = null;
  vi.restoreAllMocks();
});

const moment = (index: number, clip: string): MemoryMoment => ({
  index,
  clip_id: clip,
  clip_title: '60th birthday',
  recorded_at: null,
  start_s: 10 * index + 2,
  end_s: 10 * index + 8,
  proxy_url: `https://m/${clip}.mp4`,
  thumb_url: null,
  people: [{ person_id: 'p_k', name: 'Kristoff', crop_url: null }],
  line: `Line ${String(index + 1)}`,
  prompt: 'What do you remember?',
  checked: true,
  fixed_note: null,
});

const MOMENTS = [moment(0, 'c1'), moment(1, 'c1'), moment(2, 'c2')];

const box: { session: MemorySession | null; video: HTMLVideoElement | null } = { session: null, video: null };

function Probe() {
  const session = useMemorySession(MOMENTS);
  useEffect(() => {
    box.session = session;
  });
  return (
    <video
      ref={(element) => {
        session.bindVideo(element);
        box.video = element;
      }}
    />
  );
}

async function open() {
  const voice = fakeSpeaker(true);
  view = await mount(<Probe />, fakeServices({ speaker: voice.speaker }));
  return voice;
}

/** The new source's metadata arrives (jsdom never loads media), so the start second can land. */
const loadMetadata = () => {
  const video = box.video;
  if (video === null) throw new Error('no video');
  Object.defineProperty(video, 'readyState', { configurable: true, value: 1 });
  act(() => {
    video.dispatchEvent(new Event('loadedmetadata'));
  });
};

const press = (action: Parameters<MemorySession['act']>[0]) => {
  act(() => {
    box.session?.act(action);
  });
};

describe('useMemorySession', () => {
  it('waits for Begin, then reads moment 1 and plays its stretch low', async () => {
    const voice = await open();
    expect(voice.spoken()).toEqual([]);

    act(() => {
      box.session?.begin();
    });

    expect(voice.spoken()).toEqual(['Line 1']);
    expect(box.video?.getAttribute('src')).toBe('https://m/c1.mp4');
    loadMetadata();
    expect(box.video?.currentTime).toBe(2);
    expect(box.video?.volume).toBe(0.3);
    expect(videoPlay).toHaveBeenCalledOnce();
  });

  it('Next reads the next line and hides the names again; Again repeats the same line', async () => {
    const voice = await open();
    act(() => {
      box.session?.begin();
    });
    press({ type: 'reveal' });
    expect(box.session?.state.isRevealed).toBe(true);

    press({ type: 'next' });
    expect(box.session?.state).toMatchObject({ at: 1, isRevealed: false });
    press({ type: 'again' });

    expect(voice.spoken()).toEqual(['Line 1', 'Line 2', 'Line 2']);
    expect(box.session?.moment?.index).toBe(1);
  });

  it('switches the video source for a moment from another clip', async () => {
    await open();
    act(() => {
      box.session?.begin();
    });
    press({ type: 'next' });
    press({ type: 'next' });

    expect(box.video?.getAttribute('src')).toBe('https://m/c2.mp4');
    loadMetadata();
    expect(box.video?.currentTime).toBe(22);
  });

  it('Next after the last moment ends quietly; Watch again starts over', async () => {
    const voice = await open();
    act(() => {
      box.session?.begin();
    });
    press({ type: 'next' });
    press({ type: 'next' });
    press({ type: 'next' });

    expect(box.session?.state.isEnded).toBe(true);
    expect(videoPause).toHaveBeenCalled();
    expect(voice.spoken()).toEqual(['Line 1', 'Line 2', 'Line 3']);

    press({ type: 'restart' });
    expect(box.session?.state).toMatchObject({ at: 0, isEnded: false });
    expect(voice.spoken().at(-1)).toBe('Line 1');
  });

  it('→ and space move the session once it has begun', async () => {
    const voice = await open();
    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight' }));
    });
    expect(box.session?.state.at).toBe(0);

    act(() => {
      box.session?.begin();
    });
    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight' }));
    });
    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: ' ' }));
    });

    expect(voice.spoken()).toEqual(['Line 1', 'Line 2', 'Line 2']);
  });
});
