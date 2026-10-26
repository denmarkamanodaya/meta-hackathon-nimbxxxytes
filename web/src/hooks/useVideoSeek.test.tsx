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
});
