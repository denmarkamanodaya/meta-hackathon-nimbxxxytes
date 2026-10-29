import { describe, expect, it, vi } from 'vitest';
import { createDeviceVoice, type SynthTarget, type UtteranceTarget } from './device-voice';

type Voice = ReturnType<SynthTarget['getVoices']>[number];

const voice = (name: string, lang: string) => ({ name, lang, localService: true, default: false, voiceURI: name }) as Voice;

function fakeSynth(voices: Voice[] = [voice('Zarvox', 'en-US'), voice('Serena', 'en-GB')]) {
  const spoken: UtteranceTarget[] = [];
  let onVoices: (() => void) | null = null;
  const synth = {
    voices,
    speak: vi.fn((utterance: UtteranceTarget) => {
      spoken.push(utterance);
    }),
    cancel: vi.fn(),
    pause: vi.fn(),
    resume: vi.fn(),
    getVoices: vi.fn(() => synth.voices),
    addEventListener: vi.fn((_type: 'voiceschanged', listener: () => void) => {
      onVoices = listener;
    }),
  };
  return { synth, spoken, voicesChanged: () => onVoices?.() };
}

const makeUtterance = (text: string): UtteranceTarget => ({ text, voice: null, lang: '', rate: 1, volume: 1, onend: null, onerror: null });

const errorEvent = (error: string) => ({ error }) as SpeechSynthesisErrorEvent;

describe('createDeviceVoice', () => {
  it('queues every sentence at once in the chosen voice at 0.95, and ends after the last', () => {
    const { synth, spoken } = fakeSynth();
    const speaker = createDeviceVoice({ synth, makeUtterance });
    const onEnd = vi.fn();

    speaker.speak('Your bill is due. Pay it by Friday.', { onEnd, onError: vi.fn() });

    expect(spoken.map((u) => u.text)).toEqual(['Your bill is due.', 'Pay it by Friday.']);
    expect(spoken.every((u) => u.voice?.name === 'Serena' && u.rate === 0.95 && u.lang === 'en-GB')).toBe(true);
    spoken[0]?.onend?.({} as SpeechSynthesisEvent);
    expect(onEnd).not.toHaveBeenCalled();
    spoken[1]?.onend?.({} as SpeechSynthesisEvent);
    expect(onEnd).toHaveBeenCalledTimes(1);
  });

  it('stop cancels and runs the pending onEnd once; the cancel errors are ignored', () => {
    const { synth, spoken } = fakeSynth();
    const speaker = createDeviceVoice({ synth, makeUtterance });
    const onEnd = vi.fn();
    const onError = vi.fn();

    speaker.speak('One. Two.', { onEnd, onError });
    speaker.stop();
    speaker.stop();
    spoken[0]?.onerror?.(errorEvent('interrupted'));

    expect(synth.cancel).toHaveBeenCalled();
    expect(onEnd).toHaveBeenCalledTimes(1);
    expect(onError).not.toHaveBeenCalled();
  });

  it('a real error stops the queue and reports onError instead of onEnd', () => {
    const { synth, spoken } = fakeSynth();
    const speaker = createDeviceVoice({ synth, makeUtterance });
    const onEnd = vi.fn();
    const onError = vi.fn();

    speaker.speak('One. Two.', { onEnd, onError });
    spoken[0]?.onerror?.(errorEvent('synthesis-failed'));
    spoken[1]?.onend?.({} as SpeechSynthesisEvent);

    expect(onError).toHaveBeenCalledTimes(1);
    expect(onEnd).not.toHaveBeenCalled();
  });

  it('a cancel from outside only ends it, never as a failure', () => {
    const { synth, spoken } = fakeSynth();
    const speaker = createDeviceVoice({ synth, makeUtterance });
    const onEnd = vi.fn();
    const onError = vi.fn();

    speaker.speak('One. Two.', { onEnd, onError });
    spoken[0]?.onerror?.(errorEvent('interrupted'));

    expect(onEnd).toHaveBeenCalledTimes(1);
    expect(onError).not.toHaveBeenCalled();
  });

  it('a new speak ends the one before it', () => {
    const { synth } = fakeSynth();
    const speaker = createDeviceVoice({ synth, makeUtterance });
    const first = vi.fn();

    speaker.speak('One.', { onEnd: first, onError: vi.fn() });
    speaker.speak('Two.', { onEnd: vi.fn(), onError: vi.fn() });

    expect(first).toHaveBeenCalledTimes(1);
  });

  it('is unavailable with no speech or no usable voice, and picks a voice that loads late', () => {
    expect(createDeviceVoice({ synth: undefined, makeUtterance }).isAvailable()).toBe(false);
    const { synth, voicesChanged } = fakeSynth([]);
    const onVoice = vi.fn();
    const speaker = createDeviceVoice({ synth, makeUtterance, onVoice });
    expect(speaker.isAvailable()).toBe(false);

    synth.voices = [voice('Karen', 'en-AU')];
    voicesChanged();

    expect(speaker.isAvailable()).toBe(true);
    expect(onVoice).toHaveBeenCalledWith('Karen');
  });

  it('pause and resume act only while something speaks; unlock speaks silence when idle', () => {
    const { synth, spoken } = fakeSynth();
    const speaker = createDeviceVoice({ synth, makeUtterance });

    speaker.pause();
    expect(synth.pause).not.toHaveBeenCalled();
    speaker.unlock();
    expect(spoken[0]?.volume).toBe(0);

    speaker.speak('Hello.', { onEnd: vi.fn(), onError: vi.fn() });
    speaker.pause();
    speaker.resume();
    expect(synth.pause).toHaveBeenCalledTimes(1);
    expect(synth.resume).toHaveBeenCalled();
  });

  it('ends at once for blank text', () => {
    const { synth } = fakeSynth();
    const onEnd = vi.fn();
    createDeviceVoice({ synth, makeUtterance }).speak('  ', { onEnd, onError: vi.fn() });
    expect(onEnd).toHaveBeenCalledTimes(1);
    expect(synth.speak).not.toHaveBeenCalled();
  });
});
