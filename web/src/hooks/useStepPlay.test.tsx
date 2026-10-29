// ▶ Play plays a step's voice and clip together from the tap, and ends when both have ended, on a
// second tap, on stop or when the page closes.
import { act, useEffect } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';
import { fakeServices, mount, type Mounted } from '../test-support/services';
import { useStepPlay, type PlayableStep, type StepPlayControls } from './useStepPlay';

let view: Mounted | null = null;
let clipPlay: MockInstance<HTMLMediaElement['play']>;
let clipPause: MockInstance<HTMLMediaElement['pause']>;

beforeEach(() => {
  clipPlay = vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined);
  clipPause = vi.spyOn(HTMLMediaElement.prototype, 'pause').mockReturnValue(undefined);
});

afterEach(() => {
  view?.unmount();
  view = null;
  vi.restoreAllMocks();
});

const box: { player: StepPlayControls | null } = { player: null };

function Probe() {
  const { playing, bindClip, toggle, stop } = useStepPlay();
  useEffect(() => {
    box.player = { playing, bindClip, toggle, stop };
  });
  return (
    <>
      <output>{String(playing)}</output>
      <video ref={bindClip} />
    </>
  );
}

const BOTH: PlayableStep = { n: 3, audio_url: 'https://m/step-3.wav', clip_url: 'https://m/step-3.mp4' };

const shown = () => view?.container.querySelector('output')?.textContent;
const clip = () => {
  const element = view?.container.querySelector('video');
  if (element === null || element === undefined) throw new Error('no video');
  return element;
};

async function mountWith() {
  const stepAudio = { play: vi.fn<(url: string, onEnd: () => void) => void>(), stop: vi.fn(), pause: vi.fn(), resume: vi.fn(), position: vi.fn(() => null) };
  view = await mount(<Probe />, fakeServices({ stepAudio }));
  const voiceEnded = () => {
    act(() => {
      stepAudio.play.mock.calls[0]?.[1]();
    });
  };
  const clipEnded = () => {
    act(() => {
      clip().onended?.(new Event('ended'));
    });
  };
  return { stepAudio, voiceEnded, clipEnded };
}

describe('useStepPlay', () => {
  it('starts the voice and the clip from the start in the same tap', async () => {
    const { stepAudio } = await mountWith();
    clip().currentTime = 4;

    act(() => {
      box.player?.toggle(BOTH);
    });

    expect(stepAudio.play).toHaveBeenCalledWith('https://m/step-3.wav', expect.any(Function));
    expect(clipPlay).toHaveBeenCalledTimes(1);
    expect(clip().currentTime).toBe(0);
    expect(shown()).toBe('3');
  });

  it('keeps playing until both the voice and the clip have ended', async () => {
    const { voiceEnded, clipEnded } = await mountWith();
    act(() => {
      box.player?.toggle(BOTH);
    });

    clipEnded();
    expect(shown()).toBe('3');
    voiceEnded();
    expect(shown()).toBe('null');
  });

  it('stops both on a second tap', async () => {
    const { stepAudio } = await mountWith();
    act(() => {
      box.player?.toggle(BOTH);
    });

    act(() => {
      box.player?.toggle(BOTH);
    });

    expect(stepAudio.stop).toHaveBeenCalled();
    expect(clipPause).toHaveBeenCalled();
    expect(stepAudio.play).toHaveBeenCalledTimes(1);
    expect(shown()).toBe('null');
  });

  it('stops both on stop (a step change), and a late end of the old voice leaves the new step playing', async () => {
    const { stepAudio, voiceEnded } = await mountWith();
    act(() => {
      box.player?.toggle({ ...BOTH, clip_url: null });
    });

    act(() => {
      box.player?.stop();
    });
    expect(stepAudio.stop).toHaveBeenCalled();
    expect(clipPause).toHaveBeenCalled();
    expect(shown()).toBe('null');

    act(() => {
      box.player?.toggle({ ...BOTH, n: 4 });
    });
    voiceEnded();
    expect(shown()).toBe('4');
  });

  it('plays only the clip when the step has no voice, and ends with it', async () => {
    const { stepAudio, clipEnded } = await mountWith();

    act(() => {
      box.player?.toggle({ ...BOTH, audio_url: null });
    });
    expect(stepAudio.play).not.toHaveBeenCalled();
    expect(clipPlay).toHaveBeenCalledTimes(1);
    expect(shown()).toBe('3');

    clipEnded();
    expect(shown()).toBe('null');
  });

  it('plays only the voice when the step has no clip, and ends with it', async () => {
    const { stepAudio, voiceEnded } = await mountWith();

    act(() => {
      box.player?.toggle({ ...BOTH, clip_url: null });
    });
    expect(stepAudio.play).toHaveBeenCalledTimes(1);
    expect(clipPlay).not.toHaveBeenCalled();

    voiceEnded();
    expect(shown()).toBe('null');
  });

  it('does nothing for a step with neither voice nor clip', async () => {
    const { stepAudio } = await mountWith();

    act(() => {
      box.player?.toggle({ n: 3, audio_url: null, clip_url: null });
    });

    expect(stepAudio.play).not.toHaveBeenCalled();
    expect(clipPlay).not.toHaveBeenCalled();
    expect(shown()).toBe('null');
  });

  it('counts a refused clip as ended, so the voice alone finishes the play', async () => {
    clipPlay.mockRejectedValue(new Error('NotAllowedError'));
    const { voiceEnded } = await mountWith();

    await act(async () => {
      box.player?.toggle(BOTH);
      await Promise.resolve();
    });
    expect(shown()).toBe('3');

    voiceEnded();
    expect(shown()).toBe('null');
  });

  it('stops the voice when the page closes', async () => {
    const { stepAudio } = await mountWith();

    view?.unmount();
    view = null;

    expect(stepAudio.stop).toHaveBeenCalled();
  });
});
