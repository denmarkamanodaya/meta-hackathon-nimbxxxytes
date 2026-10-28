import { describe, expect, it, vi } from 'vitest';
import { createStepAudio, type AudioTarget } from './step-audio';

function fakeAudio(play: () => Promise<void> = () => Promise.resolve()) {
  const audio: AudioTarget = { src: '', currentTime: 5, onended: null, play: vi.fn(play), pause: vi.fn() };
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
});
