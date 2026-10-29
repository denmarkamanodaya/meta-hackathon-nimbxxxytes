import { describe, expect, it, vi } from 'vitest';
import { createStepAudio, type AudioTarget } from './step-audio';

function fakeAudio(play: () => Promise<void> = () => Promise.resolve()) {
  const audio: AudioTarget = { src: '', currentTime: 5, duration: 21, onended: null, play: vi.fn(play), pause: vi.fn() };
  return audio;
}

describe('createStepAudio', () => {
  it('calls play synchronously with the step URL from the start, on one reused element', () => {
    const audio = fakeAudio();
    const make = vi.fn(() => audio);
    const player = createStepAudio(make);

    player.play('https://m/step-1.wav', () => undefined);
    player.play('https://m/step-2.wav', () => undefined);

    expect(make).toHaveBeenCalledTimes(1);
    expect(audio.play).toHaveBeenCalledTimes(2);
    expect(audio.src).toBe('https://m/step-2.wav');
    expect(audio.currentTime).toBe(0);
  });

  it('ends the first sound when a second starts, and calls onEnd when it finishes', () => {
    const audio = fakeAudio();
    const player = createStepAudio(() => audio);
    const first = vi.fn();
    const second = vi.fn();

    player.play('a', first);
    player.play('b', second);
    audio.onended?.(new Event('ended'));

    expect(first).toHaveBeenCalledTimes(1);
    expect(second).toHaveBeenCalledTimes(1);
  });

  it('stop pauses and calls onEnd once', () => {
    const audio = fakeAudio();
    const player = createStepAudio(() => audio);
    const onEnd = vi.fn();

    player.play('a', onEnd);
    player.stop();
    player.stop();

    expect(audio.pause).toHaveBeenCalled();
    expect(onEnd).toHaveBeenCalledTimes(1);
  });

  it('calls onEnd when the browser refuses to play', async () => {
    const audio = fakeAudio(() => Promise.reject(new Error('NotAllowedError')));
    const player = createStepAudio(() => audio);
    const onEnd = vi.fn();

    player.play('a', onEnd);
    await Promise.resolve();
    await Promise.resolve();

    expect(onEnd).toHaveBeenCalledTimes(1);
  });

  it('pauses and resumes the same sound, keeping onEnd pending, and reports how far it is', () => {
    const audio = fakeAudio();
    const player = createStepAudio(() => audio);
    const onEnd = vi.fn();

    expect(player.position()).toBeNull();
    player.play('a', onEnd);
    audio.currentTime = 9;
    player.pause();
    player.resume();

    expect(audio.pause).toHaveBeenCalledTimes(1);
    expect(audio.play).toHaveBeenCalledTimes(2);
    expect(audio.src).toBe('a');
    expect(onEnd).not.toHaveBeenCalled();
    expect(player.position()).toEqual({ atS: 9, lengthS: 21 });
  });

  it('does nothing on pause or resume when nothing plays', () => {
    const audio = fakeAudio();
    const player = createStepAudio(() => audio);
    player.play('a', () => undefined);
    player.stop();
    player.resume();

    expect(audio.play).toHaveBeenCalledTimes(1);
    expect(player.position()).toBeNull();
  });
});
