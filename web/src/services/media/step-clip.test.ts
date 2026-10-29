import { describe, expect, it, vi } from 'vitest';
import { startClip, stopClip, type ClipTarget } from './step-clip';

function fakeClip(play: () => Promise<void> = () => Promise.resolve()) {
  const clip: ClipTarget = { currentTime: 7, onended: null, play: vi.fn(play), pause: vi.fn() };
  return clip;
}

describe('startClip', () => {
  it('plays from the start at once and calls onEnd once when the clip ends', () => {
    const clip = fakeClip();
    const onEnd = vi.fn();

    startClip(clip, onEnd);
    expect(clip.play).toHaveBeenCalledTimes(1);
    expect(clip.currentTime).toBe(0);

    clip.onended?.(new Event('ended'));
    clip.onended?.(new Event('ended'));
    expect(onEnd).toHaveBeenCalledTimes(1);
  });

  it('calls onEnd when the browser refuses to play the clip', async () => {
    const clip = fakeClip(() => Promise.reject(new Error('NotAllowedError')));
    const onEnd = vi.fn();

    startClip(clip, onEnd);
    await Promise.resolve();
    await Promise.resolve();

    expect(onEnd).toHaveBeenCalledTimes(1);
  });
});

describe('stopClip', () => {
  it('pauses the clip and drops the pending onEnd', () => {
    const clip = fakeClip();
    const onEnd = vi.fn();
    startClip(clip, onEnd);

    stopClip(clip);
    clip.onended?.(new Event('ended'));

    expect(clip.pause).toHaveBeenCalledTimes(1);
    expect(onEnd).not.toHaveBeenCalled();
  });
});
