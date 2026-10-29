// The read-aloud player: one answer, or a letter in turn, with pause, stop, and the no-voice line.
// Behaviour change 2026-10-29: the device voice says the stored text (summary, then the whole
// letter) and the WAVs are only the fallback; the tests without a speaker cover that fallback (the
// summary WAV, then each part fetched when it is next).
import { act, useEffect } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { FROM_PART_ZERO, FROM_SUMMARY } from '../core/iread/read-aloud';
import type { ApiClient } from '../services/api/client';
import { SILENT_WAV_URL } from '../services/media/wav-url';
import { fakeSpeaker, type FakeSpeaker } from '../test-support/fake-speaker';
import { fakeApi, fakeServices, mount, type Mounted } from '../test-support/services';
import { useReadAloud, type LetterToRead, type ReadAloud } from './useReadAloud';

let view: Mounted | null = null;
afterEach(() => {
  view?.unmount();
  view = null;
});

const box: { player: ReadAloud | null } = { player: null };

function Probe() {
  const player = useReadAloud();
  useEffect(() => {
    box.player = player;
  });
  return null;
}

const player = (): ReadAloud => {
  if (box.player === null) throw new Error('no player');
  return box.player;
};

const settle = () =>
  act(async () => {
    for (let i = 0; i < 6; i += 1) await Promise.resolve();
  });

async function mountWith(speakDocument?: ApiClient['speakDocument'], speaker: FakeSpeaker = fakeSpeaker(false)) {
  const stepAudio = {
    play: vi.fn<(url: string, onEnd: () => void) => void>(),
    stop: vi.fn(),
    pause: vi.fn(),
    resume: vi.fn(),
    position: vi.fn(() => null),
  };
  const api = fakeApi(speakDocument === undefined ? {} : { speakDocument: vi.fn(speakDocument) });
  view = await mount(<Probe />, fakeServices({ stepAudio, api, speaker: speaker.speaker }));
  /** Ends the sound played with `url` (the newest such call). */
  const ended = async (url: string) => {
    const call = stepAudio.play.mock.calls.filter(([played]) => played === url).pop();
    if (call === undefined) throw new Error(`${url} never played`);
    act(() => {
      call[1]();
    });
    await settle();
  };
  const played = () => stepAudio.play.mock.calls.map(([url]) => url).filter((url) => url !== SILENT_WAV_URL);
  return { stepAudio, api, ended, played };
}

const letter = (id: string, summary_audio_url: string | null, text = 'Dear Sam. Pay by Friday.'): LetterToRead => ({
  id,
  summary: 'A water bill.',
  text,
  summary_audio_url,
});

const part = (n: number, parts: number, audio: string | null = `https://m/p${String(n)}.wav`) =>
  Promise.resolve({ part: n, parts, text: `Part ${String(n)}.`, audio_url: audio });

describe('useReadAloud', () => {
  it('plays an answer and goes idle when it ends', async () => {
    const { ended } = await mountWith();

    act(() => {
      player().playAnswer('Pay by Friday.', 'https://m/answer.wav');
    });
    expect(player().status).toBe('playing');
    await ended('https://m/answer.wav');

    expect(player().status).toBe('idle');
  });

  it('shows the no-voice line for a null voice and plays nothing', async () => {
    const { stepAudio } = await mountWith();

    act(() => {
      player().playAnswer('Pay by Friday.', null);
    });

    expect(stepAudio.play).not.toHaveBeenCalled();
    expect(player()).toMatchObject({ status: 'idle', message: 'Voice not available right now' });
  });

  it('Read it to me: the summary, then each part fetched when it is next, then stops', async () => {
    const speak = vi.fn((_id: string, n: number) => part(n, 2));
    const { ended, played } = await mountWith(speak);

    act(() => {
      player().readDocument(letter('doc_water', 'https://m/summary.wav'), FROM_SUMMARY);
    });
    expect(played()).toEqual(['https://m/summary.wav']);
    expect(speak).not.toHaveBeenCalled();

    await ended('https://m/summary.wav');
    expect(speak).toHaveBeenLastCalledWith('doc_water', 0);
    expect(player()).toMatchObject({ status: 'playing', item: { kind: 'part', part: 0 }, parts: 2 });

    await ended('https://m/p0.wav');
    await ended('https://m/p1.wav');

    expect(played()).toEqual(['https://m/summary.wav', 'https://m/p0.wav', 'https://m/p1.wav']);
    expect(speak).toHaveBeenCalledTimes(2);
    expect(player().status).toBe('idle');
  });

  it('skips a missing summary voice and starts at part 0, unlocking playback inside the tap', async () => {
    const speak = vi.fn((_id: string, n: number) => part(n, 1));
    const { stepAudio } = await mountWith(speak);

    act(() => {
      player().readDocument(letter('doc_sam', null), FROM_SUMMARY);
    });
    await settle();

    expect(stepAudio.play.mock.calls[0]?.[0]).toBe(SILENT_WAV_URL);
    expect(speak).toHaveBeenCalledWith('doc_sam', 0);
  });

  it('stops the letter at a part with no voice, with the no-voice line', async () => {
    const { played } = await mountWith((_id, n) => part(n, 3, null));

    act(() => {
      player().readDocument(letter('doc_rates', null), FROM_PART_ZERO);
    });
    await settle();

    expect(played()).toEqual([]);
    expect(player()).toMatchObject({ status: 'idle', message: 'Voice not available right now', parts: 3 });
  });

  it('pauses and resumes; Stop ends the run so a late part never plays', async () => {
    let answer: (value: Awaited<ReturnType<ApiClient['speakDocument']>>) => void = () => undefined;
    const pending = new Promise<Awaited<ReturnType<ApiClient['speakDocument']>>>((resolve) => {
      answer = resolve;
    });
    const { stepAudio, ended, played } = await mountWith(() => pending);

    act(() => {
      player().readDocument(letter('doc_water', 'https://m/summary.wav'), FROM_SUMMARY);
    });
    act(() => {
      player().pause();
    });
    expect(stepAudio.pause).toHaveBeenCalled();
    expect(player().status).toBe('paused');
    act(() => {
      player().resume();
    });
    expect(player().status).toBe('playing');

    await ended('https://m/summary.wav');
    expect(player().status).toBe('loading');
    act(() => {
      player().stop();
    });
    answer({ part: 0, parts: 2, text: 'x', audio_url: 'https://m/late.wav' });
    await settle();

    expect(played()).toEqual(['https://m/summary.wav']);
    expect(player().status).toBe('idle');
  });

  it('says an answer in the device voice; no WAV plays', async () => {
    const speaker = fakeSpeaker(true);
    const { stepAudio } = await mountWith(undefined, speaker);

    act(() => {
      player().playAnswer('Pay by Friday.', 'https://m/answer.wav');
    });
    expect(speaker.spoken()).toEqual(['Pay by Friday.']);
    expect(stepAudio.play).not.toHaveBeenCalled();
    expect(player()).toMatchObject({ status: 'playing', canSpeak: true });

    act(() => {
      speaker.end();
    });
    expect(player().status).toBe('idle');
  });

  it('Read it to me in the device voice: the stored summary, then the stored letter, with no fetch', async () => {
    const speak = vi.fn((_id: string, n: number) => part(n, 2));
    const speaker = fakeSpeaker(true);
    const { played } = await mountWith(speak, speaker);

    act(() => {
      player().readDocument(letter('doc_water', 'https://m/summary.wav'), FROM_SUMMARY);
    });
    expect(speaker.spoken()).toEqual(['A water bill.']);
    act(() => {
      speaker.end();
    });
    expect(speaker.spoken()).toEqual(['A water bill.', 'Dear Sam. Pay by Friday.']);
    expect(player()).toMatchObject({ status: 'playing', item: { kind: 'part', part: 0 } });
    act(() => {
      speaker.end();
    });
    await settle();

    expect(player().status).toBe('idle');
    expect(speak).not.toHaveBeenCalled();
    expect(played()).toEqual([]);
  });

  it('falls back to the summary WAV, then the server parts, when the device voice fails', async () => {
    const speak = vi.fn((_id: string, n: number) => part(n, 1));
    const speaker = fakeSpeaker(true);
    const { ended, played } = await mountWith(speak, speaker);

    act(() => {
      player().readDocument(letter('doc_water', 'https://m/summary.wav'), FROM_SUMMARY);
    });
    act(() => {
      speaker.fail();
    });
    expect(played()).toEqual(['https://m/summary.wav']);
    await ended('https://m/summary.wav');
    act(() => {
      speaker.fail();
    });
    await settle();

    expect(speak).toHaveBeenCalledWith('doc_water', 0);
    expect(speaker.spoken().at(-1)).toBe('Part 0.');
  });

  it('a letter with no stored text is read part by part from the server, each part said in the device voice', async () => {
    const speak = vi.fn((_id: string, n: number) => part(n, 2));
    const speaker = fakeSpeaker(true);
    await mountWith(speak, speaker);

    act(() => {
      player().readDocument(letter('doc_rates', null, ''), FROM_PART_ZERO);
    });
    await settle();
    expect(speaker.mocks.unlock).toHaveBeenCalled();
    act(() => {
      speaker.end();
    });
    await settle();
    act(() => {
      speaker.end();
    });
    await settle();

    expect(speaker.spoken()).toEqual(['Part 0.', 'Part 1.']);
    expect(player().status).toBe('idle');
  });

  it('goes idle when another voice starts over it', async () => {
    const speaker = fakeSpeaker(true);
    await mountWith(undefined, speaker);
    act(() => {
      player().playAnswer('First.', null);
    });

    // Another hook on the same speaker takes the voice.
    function Other() {
      const other = useReadAloud();
      const { playAnswer } = other;
      useEffect(() => {
        playAnswer('Second.', null);
      }, [playAnswer]);
      return null;
    }
    const second = await mount(<Other />, fakeServices({ speaker: speaker.speaker }));

    expect(speaker.spoken()).toEqual(['First.', 'Second.']);
    expect(player().status).toBe('idle');
    second.unmount();
  });
});
