import { act, useEffect } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { fakeServices, mount, type Mounted } from '../test-support/services';
import { useVideoSeek } from './useVideoSeek';

const handle: { seek: ((seconds: number) => void) | null } = { seek: null };

function Player() {
  const { ref, currentTime, seek, onTimeUpdate } = useVideoSeek();
  useEffect(() => {
    handle.seek = seek;
  });
  return (
    <>
      <video ref={ref} onTimeUpdate={onTimeUpdate} />
      <output>{currentTime}</output>
    </>
  );
}

let view: Mounted | null = null;
afterEach(() => {
  view?.unmount();
  view = null;
  vi.restoreAllMocks();
});

function stubMedia(durationS: number) {
  const play = vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined);
  vi.spyOn(HTMLMediaElement.prototype, 'duration', 'get').mockReturnValue(durationS);
  return play;
}

describe('useVideoSeek', () => {
  it('seeks the video to the tapped second and plays', async () => {
    const play = stubMedia(60);
    view = await mount(<Player />, fakeServices());

    act(() => {
      handle.seek?.(12.6);
    });

    expect(view.container.querySelector('video')?.currentTime).toBe(12.6);
    expect(view.container.querySelector('output')?.textContent).toBe('12.6');
    expect(play).toHaveBeenCalled();
  });

  it('clamps a seek past the end to the duration', async () => {
    stubMedia(30);
    view = await mount(<Player />, fakeServices());

    act(() => {
      handle.seek?.(45);
    });

    expect(view.container.querySelector('video')?.currentTime).toBe(30);
  });

  it('survives a refused play()', async () => {
    vi.spyOn(HTMLMediaElement.prototype, 'play').mockRejectedValue(new DOMException('no', 'NotAllowedError'));
    view = await mount(<Player />, fakeServices());

    await act(async () => {
      handle.seek?.(3);
      await Promise.resolve();
    });

    expect(view.container.querySelector('video')?.currentTime).toBe(3);
  });

  it('applies the deep-link start once when metadata loads, without playing', async () => {
    const play = stubMedia(60);
    function Linked() {
      const { ref, onLoadedMetadata } = useVideoSeek(21.5);
      return <video ref={ref} onLoadedMetadata={onLoadedMetadata} />;
    }
    view = await mount(<Linked />, fakeServices());
    const video = view.container.querySelector('video');

    act(() => {
      video?.dispatchEvent(new Event('loadedmetadata'));
    });
    expect(video?.currentTime).toBe(21.5);

    if (video) video.currentTime = 5;
    act(() => {
      video?.dispatchEvent(new Event('loadedmetadata'));
    });
    expect(video?.currentTime).toBe(5);
    expect(play).not.toHaveBeenCalled();
  });
});
