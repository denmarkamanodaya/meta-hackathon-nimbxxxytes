// The one read-aloud voice: the device voice first, the server WAV as the fallback (no device
// voice, or the device fails), one voice at a time across hooks, and pause, resume and stop.
import { act, useEffect } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SILENT_WAV_URL } from '../services/media/wav-url';
import { fakeSpeaker } from '../test-support/fake-speaker';
import { fakeServices, mount, type Mounted } from '../test-support/services';
import { useReadAloudText, type ReadAloudText } from './useReadAloudText';

const views: Mounted[] = [];
afterEach(() => {
  for (const view of views.splice(0)) view.unmount();
});

const boxes: Record<string, ReadAloudText | null> = {};

function Probe({ name }: { name: string }) {
  const voice = useReadAloudText();
  useEffect(() => {
    boxes[name] = voice;
  });
  return null;
}

const voiceOf = (name: string): ReadAloudText => {
  const voice = boxes[name];
  if (voice === null || voice === undefined) throw new Error(`no ${name}`);
  return voice;
};

function fakeStepAudio() {
  return { play: vi.fn<(url: string, onEnd: () => void) => void>(), stop: vi.fn(), pause: vi.fn(), resume: vi.fn(), position: vi.fn(() => ({ atS: 2, lengthS: 9 })) };
}

async function mountWith(available: boolean, names: string[] = ['a']) {
  const speaker = fakeSpeaker(available);
  const stepAudio = fakeStepAudio();
  const services = fakeServices({ speaker: speaker.speaker, stepAudio });
  for (const name of names) views.push(await mount(<Probe name={name} />, services));
  return { speaker, stepAudio };
}

describe('useReadAloudText', () => {
  it('speaks in the device voice, with no WAV, and ends with onEnd("ended")', async () => {
    const { speaker, stepAudio } = await mountWith(true);
    const onEnd = vi.fn();

    let started = false;
    act(() => {
      started = voiceOf('a').say('Hello there.', 'https://m/a.wav', onEnd);
    });
    expect(started).toBe(true);
    expect(speaker.spoken()).toEqual(['Hello there.']);
    expect(stepAudio.play).not.toHaveBeenCalled();
    expect(voiceOf('a')).toMatchObject({ status: 'playing', canSpeak: true });
    expect(voiceOf('a').position()).toBeNull();

    act(() => {
      speaker.end();
    });
    expect(onEnd).toHaveBeenCalledWith('ended');
    expect(voiceOf('a').status).toBe('idle');
  });

  it('plays the WAV when the device has no usable voice', async () => {
    const { speaker, stepAudio } = await mountWith(false);
    const onEnd = vi.fn();

    act(() => {
      voiceOf('a').say('Hello there.', 'https://m/a.wav', onEnd);
    });
    expect(speaker.mocks.speak).not.toHaveBeenCalled();
    expect(stepAudio.play).toHaveBeenCalledWith('https://m/a.wav', expect.any(Function));
    expect(voiceOf('a').position()).toEqual({ atS: 2, lengthS: 9 });

    act(() => {
      stepAudio.play.mock.calls[0]?.[1]();
    });
    expect(onEnd).toHaveBeenCalledWith('ended');
  });

  it('plays the WAV when the device fails part way, and says "failed" when there is no WAV', async () => {
    const { speaker, stepAudio } = await mountWith(true);
    const onEnd = vi.fn();

    act(() => {
      voiceOf('a').say('Hello there.', 'https://m/a.wav', onEnd);
    });
    act(() => {
      speaker.fail();
    });
    expect(stepAudio.play).toHaveBeenCalledWith('https://m/a.wav', expect.any(Function));
    expect(onEnd).not.toHaveBeenCalled();

    act(() => {
      voiceOf('a').say('Again.', null, onEnd);
    });
    act(() => {
      speaker.fail();
    });
    expect(onEnd).toHaveBeenCalledWith('failed');
  });

  it('returns false and starts nothing with no device voice and no WAV', async () => {
    const { stepAudio } = await mountWith(false);
    let started = true;
    act(() => {
      started = voiceOf('a').say('Hello.', null);
    });
    expect(started).toBe(false);
    expect(stepAudio.play).not.toHaveBeenCalled();
    expect(voiceOf('a').status).toBe('idle');
  });

  it('one voice at a time: starting one stops the other, which hears "stopped"', async () => {
    const { speaker } = await mountWith(true, ['a', 'b']);
    const aEnd = vi.fn();
    const bEnd = vi.fn();

    act(() => {
      voiceOf('a').say('First.', null, aEnd);
    });
    act(() => {
      voiceOf('b').say('Second.', null, bEnd);
    });

    expect(aEnd).toHaveBeenCalledWith('stopped');
    expect(voiceOf('a').status).toBe('idle');
    expect(voiceOf('b').status).toBe('playing');

    // A's stop no longer touches B's voice.
    speaker.mocks.stop.mockClear();
    act(() => {
      voiceOf('a').stop();
    });
    expect(speaker.mocks.stop).not.toHaveBeenCalled();
    expect(voiceOf('b').status).toBe('playing');
  });

  it('its own stop or next say never calls the old onEnd', async () => {
    await mountWith(true);
    const first = vi.fn();

    act(() => {
      voiceOf('a').say('First.', null, first);
    });
    act(() => {
      voiceOf('a').say('Second.', null);
    });
    act(() => {
      voiceOf('a').stop();
    });

    expect(first).not.toHaveBeenCalled();
    expect(voiceOf('a').status).toBe('idle');
  });

  it('pauses and resumes the device voice, or the WAV when that plays', async () => {
    const { speaker, stepAudio } = await mountWith(true);
    act(() => {
      voiceOf('a').say('Hello.', null);
    });
    act(() => {
      voiceOf('a').pause();
    });
    expect(speaker.mocks.pause).toHaveBeenCalled();
    expect(voiceOf('a').status).toBe('paused');
    act(() => {
      voiceOf('a').resume();
    });
    expect(speaker.mocks.resume).toHaveBeenCalled();
    expect(voiceOf('a').status).toBe('playing');
    expect(stepAudio.pause).not.toHaveBeenCalled();
  });

  it('prime unlocks speech and the WAV element inside the tap', async () => {
    const { speaker, stepAudio } = await mountWith(true);
    act(() => {
      voiceOf('a').prime();
    });
    expect(speaker.mocks.unlock).toHaveBeenCalled();
    expect(stepAudio.play).toHaveBeenCalledWith(SILENT_WAV_URL, expect.any(Function));
  });
});
