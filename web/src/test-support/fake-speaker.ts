// A fake device voice that behaves as the real one does: a new speak or stop ends what spoke
// before (its onEnd runs). Tests end or fail what speaks now with `end` and `fail`.
import { vi, type Mock } from 'vitest';
import type { SpeakHandlers, Speaker } from '../core/ports/speaker';

/** The fake and its controls. */
export interface FakeSpeaker {
  speaker: Speaker;
  /** The same functions as mocks, for assertions. */
  mocks: {
    isAvailable: Mock<Speaker['isAvailable']>;
    speak: Mock<Speaker['speak']>;
    pause: Mock<Speaker['pause']>;
    resume: Mock<Speaker['resume']>;
    stop: Mock<Speaker['stop']>;
    unlock: Mock<Speaker['unlock']>;
  };
  /** The texts spoken, in order. */
  spoken: () => string[];
  /** The text speaking now ends on its own. */
  end: () => void;
  /** The device fails to speak the text speaking now. */
  fail: () => void;
}

/**
 * Builds the fake.
 * @param available - What `isAvailable` answers.
 * @returns See `FakeSpeaker`.
 */
export function fakeSpeaker(available = true): FakeSpeaker {
  let pending: SpeakHandlers | null = null;
  const take = () => {
    const handlers = pending;
    pending = null;
    return handlers;
  };
  const stop = vi.fn<Speaker['stop']>(() => {
    take()?.onEnd();
  });
  const speak = vi.fn<Speaker['speak']>((_text, handlers) => {
    take()?.onEnd();
    pending = handlers;
  });
  const speaker = {
    isAvailable: vi.fn<Speaker['isAvailable']>(() => available),
    speak,
    pause: vi.fn<Speaker['pause']>(),
    resume: vi.fn<Speaker['resume']>(),
    stop,
    unlock: vi.fn<Speaker['unlock']>(),
  };
  return {
    speaker,
    mocks: speaker,
    spoken: () => speak.mock.calls.map(([text]) => text),
    end: () => {
      take()?.onEnd();
    },
    fail: () => {
      take()?.onError();
    },
  };
}
