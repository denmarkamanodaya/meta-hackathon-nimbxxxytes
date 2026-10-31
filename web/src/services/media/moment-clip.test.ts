// The moment window holds on a WebKit-like element: a seek set before the new source's metadata is
// dropped, playback can be resumed by something else, and time updates come every quarter second.
import { describe, expect, it, vi } from 'vitest';
import { playMoment, stopMoment, type MomentTarget } from './moment-clip';

/** A video element as WebKit behaves: `currentTime` set while readyState is 0 is ignored. */
class FakeVideo implements MomentTarget {
  volume = 1;
  readyState = 0;
  paused = true;
  ontimeupdate: MomentTarget['ontimeupdate'] = null;
  onloadedmetadata: MomentTarget['onloadedmetadata'] = null;
  play = vi.fn(() => {
    this.paused = false;
    return Promise.resolve();
  });
  pause = vi.fn(() => {
    this.paused = true;
  });
  private at = 0;

  get currentTime(): number {
    return this.at;
  }

  set currentTime(seconds: number) {
    if (this.readyState === 0) return;
    this.at = seconds;
  }

  /** The new source's metadata arrives. */
  loadMetadata(): void {
    this.readyState = 4;
    this.onloadedmetadata?.(new Event('loadedmetadata'));
  }

  /** Playback moves on by `seconds` in quarter-second time updates. */
  advance(seconds: number): void {
    for (let left = seconds; left > 0; left -= 0.25) {
      if (this.paused) return;
      this.at += 0.25;
      this.ontimeupdate?.(new Event('timeupdate'));
    }
  }
}

const loaded = (at = 0) => {
  const video = new FakeVideo();
  video.loadMetadata();
  video.currentTime = at;
  return video;
};

describe('playMoment', () => {
  it('seeks to the start, plays low and pauses at the end', () => {
    const video = loaded();

    playMoment(video, { start: 12, end: 18, volume: 0.3 });

    expect(video).toMatchObject({ currentTime: 12, volume: 0.3, paused: false });
    video.advance(5.75);
    expect(video.paused).toBe(false);
    video.advance(10);
    expect(video.paused).toBe(true);
    expect(video.currentTime).toBeGreaterThanOrEqual(18);
    expect(video.currentTime).toBeLessThan(18.5);
  });

  it('a new source: the start second lands once metadata is in, not at 0 (the Mac bug)', () => {
    const video = new FakeVideo();

    playMoment(video, { start: 22, end: 28, volume: 0.3 });
    expect(video.currentTime).toBe(0);
    video.loadMetadata();

    expect(video.currentTime).toBe(22);
    video.advance(30);
    expect(video.currentTime).toBeLessThan(28.5);
  });

  it('redoes a seek the element lost, so the footage never runs from the clip start', () => {
    const video = loaded();
    playMoment(video, { start: 22, end: 28, volume: 0.3 });
    // The element drops the seek (a reload) and plays from 0.
    Object.assign(video, { at: 0 });

    video.advance(0.25);

    expect(video.currentTime).toBe(22);
  });

  it('pauses again when something resumes playback past the end', () => {
    const video = loaded();
    playMoment(video, { start: 22, end: 28, volume: 0.3 });
    video.advance(10);
    expect(video.paused).toBe(true);

    void video.play();
    video.advance(5);

    expect(video.paused).toBe(true);
    expect(video.currentTime).toBeLessThan(28.75);
  });

  it('the next moment takes over the watcher; stopMoment drops both watchers', () => {
    const video = loaded();
    playMoment(video, { start: 22, end: 28, volume: 0.3 });
    playMoment(video, { start: 40, end: 46, volume: 0.3 });
    expect(video.currentTime).toBe(40);
    video.advance(3);
    expect(video.paused).toBe(false);

    stopMoment(video);

    expect(video.paused).toBe(true);
    expect(video.ontimeupdate).toBeNull();
    expect(video.onloadedmetadata).toBeNull();
  });
});
