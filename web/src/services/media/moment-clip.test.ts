import { describe, expect, it, vi, type Mock } from 'vitest';
import { playMoment, stopMoment, type MomentTarget } from './moment-clip';

function fakeVideo(): MomentTarget & { play: Mock<MomentTarget['play']>; pause: Mock<MomentTarget['pause']> } {
  return { currentTime: 0, volume: 1, ontimeupdate: null, play: vi.fn<MomentTarget['play']>(() => Promise.resolve()), pause: vi.fn<MomentTarget['pause']>() };
}

describe('playMoment', () => {
  it('seeks to the start, plays low and pauses at the end', () => {
    const video = fakeVideo();

    playMoment(video, { start: 12, end: 18, volume: 0.3 });

    expect(video).toMatchObject({ currentTime: 12, volume: 0.3 });
    expect(video.play).toHaveBeenCalledOnce();
    video.currentTime = 17.9;
    video.ontimeupdate?.(new Event('timeupdate'));
    expect(video.pause).not.toHaveBeenCalled();
    video.currentTime = 18.1;
    video.ontimeupdate?.(new Event('timeupdate'));
    expect(video.pause).toHaveBeenCalledOnce();
    expect(video.ontimeupdate).toBeNull();
  });

  it('stopMoment pauses and drops the end watcher', () => {
    const video = fakeVideo();
    playMoment(video, { start: 0, end: 4, volume: 0.3 });

    stopMoment(video);

    expect(video.pause).toHaveBeenCalledOnce();
    expect(video.ontimeupdate).toBeNull();
  });
});
