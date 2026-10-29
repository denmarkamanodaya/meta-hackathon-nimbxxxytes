import { describe, expect, it, vi } from 'vitest';
import { createVoiceRecorder, pickVoiceType, VoiceError, type RecorderTarget } from './voice-recorder';

function fakeMic() {
  const track = { stop: vi.fn() };
  const handlers: { onData: (chunk: Blob) => void; onStop: () => void } = { onData: () => undefined, onStop: () => undefined };
  const recorder: RecorderTarget = {
    mimeType: 'audio/webm;codecs=opus',
    start: vi.fn((onData: (chunk: Blob) => void, onStop: () => void) => {
      handlers.onData = onData;
      handlers.onStop = onStop;
    }),
    stop: vi.fn(() => {
      handlers.onData(new Blob(['abc']));
      handlers.onStop();
    }),
  };
  const getUserMedia = vi.fn(() => Promise.resolve({ getTracks: () => [track] }));
  return { track, recorder, voice: createVoiceRecorder({ getUserMedia, makeRecorder: () => recorder }), getUserMedia };
}

const codeOf = async (promise: Promise<unknown>) => {
  const thrown = await promise.catch((error: unknown) => error);
  return thrown instanceof VoiceError ? thrown.code : 'none';
};

describe('voice recorder', () => {
  it('records until stop, then hands back the audio in the recorder type and frees the microphone', async () => {
    const { voice, recorder, track, getUserMedia } = fakeMic();
    const note = await voice.start();

    expect(getUserMedia).toHaveBeenCalledWith({ audio: true });
    expect(recorder.start).toHaveBeenCalledTimes(1);
    expect(track.stop).not.toHaveBeenCalled();

    const audio = await note.stop();
    expect(audio.type).toBe('audio/webm;codecs=opus');
    expect(audio.size).toBe(3);
    expect(track.stop).toHaveBeenCalledTimes(1);
  });

  it('cancel frees the microphone too', async () => {
    const { voice, track } = fakeMic();
    (await voice.start()).cancel();

    await Promise.resolve();
    expect(track.stop).toHaveBeenCalledTimes(1);
  });

  it('names why the microphone could not start', async () => {
    const refuse = (name: string) =>
      createVoiceRecorder({
        getUserMedia: () => Promise.reject(new DOMException('no', name)),
        makeRecorder: () => {
          throw new Error('unused');
        },
      }).start();

    expect(await codeOf(refuse('NotAllowedError'))).toBe('MIC_DENIED');
    expect(await codeOf(refuse('NotFoundError'))).toBe('MIC_MISSING');
    expect(await codeOf(refuse('AbortError'))).toBe('MIC_FAILED');
    expect(await codeOf(createVoiceRecorder({ getUserMedia: undefined, makeRecorder: undefined }).start())).toBe('MIC_MISSING');
  });

  it('prefers webm, then mp4, then ogg', () => {
    expect(pickVoiceType((type) => type !== 'audio/webm')).toBe('audio/mp4');
    expect(pickVoiceType(() => false)).toBeUndefined();
  });
});
