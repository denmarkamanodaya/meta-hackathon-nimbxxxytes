import { act, useEffect } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { VOICE_MAX_MS } from '../core/ask/voice';
import { ApiError, type ApiClient } from '../services/api/client';
import { ERROR } from '../services/api/types';
import { VoiceError, type VoiceRecorder, type VoiceRecording } from '../services/media/voice-recorder';
import { fakeApi, fakeServices, mount, type Mounted } from '../test-support/services';
import { useVoiceNote, type VoiceNote } from './useVoiceNote';

let view: Mounted | null = null;
beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  view?.unmount();
  view = null;
  vi.useRealTimers();
});

const box: { note: VoiceNote | null } = { note: null };
const heard: string[] = [];

function Probe() {
  const note = useVoiceNote((text) => {
    heard.push(text);
  });
  useEffect(() => {
    box.note = note;
  });
  return null;
}

const AUDIO = new Blob(['note'], { type: 'audio/webm' });

function fakeRecorder() {
  const recording: VoiceRecording = { stop: vi.fn(() => Promise.resolve(AUDIO)), cancel: vi.fn() };
  const voice: VoiceRecorder = { start: vi.fn(() => Promise.resolve(recording)) };
  return { recording, voice };
}

async function setUp(voice: VoiceRecorder, transcribe: ApiClient['transcribe'] = vi.fn<ApiClient['transcribe']>().mockResolvedValue({ text: ' make a short ' })) {
  heard.length = 0;
  view = await mount(<Probe />, fakeServices({ voice, api: fakeApi({ transcribe }) }));
  return { transcribe };
}

const step = (run: () => void, ms = 0) =>
  act(async () => {
    run();
    await vi.advanceTimersByTimeAsync(ms);
  });

describe('useVoiceNote', () => {
  it('records while held, then sends the note to transcribe and hands back the trimmed text', async () => {
    const { voice, recording } = fakeRecorder();
    const { transcribe } = await setUp(voice);

    await step(() => box.note?.press(), 2000);
    expect(box.note?.phase).toBe('recording');
    expect(box.note?.startedAt).not.toBeNull();

    await step(() => box.note?.release(), 1000);
    expect(recording.stop).toHaveBeenCalledTimes(1);
    expect(transcribe).toHaveBeenCalledWith(AUDIO);
    expect(heard).toEqual(['make a short']);
    expect(box.note?.phase).toBe('idle');
    expect(box.note?.message).toBeNull();
  });

  it('a press that is let go at once is a slip: nothing is sent', async () => {
    const { voice, recording } = fakeRecorder();
    const { transcribe } = await setUp(voice);

    await step(() => {
      box.note?.press();
      box.note?.release();
    });

    expect(recording.cancel).toHaveBeenCalledTimes(1);
    expect(transcribe).not.toHaveBeenCalled();
    expect(box.note?.message).toBe('Hold the mic while you speak');
  });

  it('stops by itself at 60 s and sends what it has, once', async () => {
    const { voice, recording } = fakeRecorder();
    const { transcribe } = await setUp(voice);

    await step(() => box.note?.press());
    await step(() => undefined, VOICE_MAX_MS);
    await step(() => box.note?.release());

    expect(recording.stop).toHaveBeenCalledTimes(1);
    expect(transcribe).toHaveBeenCalledTimes(1);
  });

  it('says the microphone is not allowed', async () => {
    await setUp({ start: () => Promise.reject(new VoiceError('MIC_DENIED', 'no')) });

    await step(() => box.note?.press());

    expect(box.note?.phase).toBe('idle');
    expect(box.note?.message).toMatch(/^Microphone not allowed/);
  });

  it("says it couldn't hear audio the server could not read, and nothing heard for empty text", async () => {
    const refused = vi.fn<ApiClient['transcribe']>().mockRejectedValue(new ApiError(ERROR.VALIDATION_FAILED, 'unreadable', 400));
    await setUp(fakeRecorder().voice, refused);
    await step(() => box.note?.press(), 2000);
    await step(() => box.note?.release(), 1000);
    expect(box.note?.message).toBe("Couldn't hear that, try again");
    view?.unmount();

    await setUp(fakeRecorder().voice, vi.fn<ApiClient['transcribe']>().mockResolvedValue({ text: '  ' }));
    await step(() => box.note?.press(), 2000);
    await step(() => box.note?.release(), 1000);
    expect(box.note?.message).toBe('Nothing heard. Hold the mic and speak');
    expect(heard).toEqual([]);
  });

  it('drops the microphone when the box goes away mid-note', async () => {
    const { voice, recording } = fakeRecorder();
    await setUp(voice);
    await step(() => box.note?.press());

    view?.unmount();
    view = null;

    expect(recording.cancel).toHaveBeenCalledTimes(1);
  });
});
