import { describe, expect, it } from 'vitest';
import { transcribeProblem, voiceMessage, waveHeights } from './voice';

describe('Ask voice words', () => {
  it('reads a refused note as unreadable audio, anything else as Transcribe not answering', () => {
    expect(transcribeProblem('VALIDATION_FAILED')).toBe('UNREADABLE');
    expect(voiceMessage('UNREADABLE')).toBe("Couldn't hear that, try again");
    expect(transcribeProblem('MODEL_UNAVAILABLE')).toBe('TRANSCRIBE_FAILED');
    expect(transcribeProblem(null)).toBe('TRANSCRIBE_FAILED');
  });

  it('draws a fixed wave inside its bounds', () => {
    const bars = waveHeights(40, 4, 18);

    expect(bars).toHaveLength(40);
    expect(Math.min(...bars)).toBeGreaterThanOrEqual(4);
    expect(Math.max(...bars)).toBeLessThanOrEqual(22);
    expect(waveHeights(40, 4, 18)).toEqual(bars);
  });
});
