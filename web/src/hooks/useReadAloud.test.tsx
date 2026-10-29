// The read-aloud player: one answer, or a letter in turn (summary, then each part fetched when it
// is next), with pause, stop, and the no-voice line when a voice URL is null.
import { act, useEffect } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { FROM_PART_ZERO, FROM_SUMMARY } from '../core/iread/read-aloud';
import type { ApiClient } from '../services/api/client';
import { SILENT_WAV_URL } from '../services/media/wav-url';
import { fakeApi, fakeServices, mount, type Mounted } from '../test-support/services';
import { useReadAloud, type ReadAloud } from './useReadAloud';

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

async function mountWith(speakDocument?: ApiClient['speakDocument']) {
  const stepAudio = {
    play: vi.fn<(url: string, onEnd: () => void) => void>(),
    stop: vi.fn(),
    pause: vi.fn(),
    resume: vi.fn(),
    position: vi.fn(() => null),
  };
  const api = fakeApi(speakDocument === undefined ? {} : { speakDocument: vi.fn(speakDocument) });
  view = await mount(<Probe />, fakeServices({ stepAudio, api }));
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

const part = (n: number, parts: number, audio: string | null = `https://m/p${String(n)}.wav`) =>
  Promise.resolve({ part: n, parts, text: `Part ${String(n)}.`, audio_url: audio });

describe('useReadAloud', () => {
  it('plays an answer and goes idle when it ends', async () => {
    const { ended } = await mountWith();

    act(() => {
      player().playUrl('https://m/answer.wav');
    });
    expect(player().status).toBe('playing');
    await ended('https://m/answer.wav');

    expect(player().status).toBe('idle');
  });

  it('shows the no-voice line for a null voice and plays nothing', async () => {
    const { stepAudio } = await mountWith();

    act(() => {
      player().playUrl(null);
    });

    expect(stepAudio.play).not.toHaveBeenCalled();
    expect(player()).toMatchObject({ status: 'idle', message: 'Voice not available right now' });
  });

  it('Read it to me: the summary, then each part fetched when it is next, then stops', async () => {
    const speak = vi.fn((_id: string, n: number) => part(n, 2));
    const { ended, played } = await mountWith(speak);

    act(() => {
      player().readDocument('doc_water', FROM_SUMMARY, 'https://m/summary.wav');
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
      player().readDocument('doc_sam', FROM_SUMMARY, null);
    });
    await settle();

    expect(stepAudio.play.mock.calls[0]?.[0]).toBe(SILENT_WAV_URL);
    expect(speak).toHaveBeenCalledWith('doc_sam', 0);
  });

  it('stops the letter at a part with no voice, with the no-voice line', async () => {
    const { played } = await mountWith((_id, n) => part(n, 3, null));

    act(() => {
      player().readDocument('doc_rates', FROM_PART_ZERO, null);
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
      player().readDocument('doc_water', FROM_SUMMARY, 'https://m/summary.wav');
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
});
