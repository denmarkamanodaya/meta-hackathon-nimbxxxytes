import { describe, expect, it } from 'vitest';
import stepSample from '../../fixtures/step_still.sample.json';
import { RING_COLOR, StepStillPropsSchema, ringWidth } from './step.ts';

describe('StepStillPropsSchema', () => {
  it('accepts the sample the Rust builder writes byte for byte', () => {
    expect(StepStillPropsSchema.parse(stepSample)).toEqual(stepSample);
  });

  it('refuses a still without an outline or with a zero size', () => {
    expect(StepStillPropsSchema.safeParse({ ...stepSample, outline: '' }).success).toBe(false);
    expect(StepStillPropsSchema.safeParse({ ...stepSample, width: 0 }).success).toBe(false);
  });
});

describe('ringWidth', () => {
  it('is 10 px on a 720 px short side and scales with it, never under 4 px', () => {
    expect(ringWidth(720, 1280)).toBe(10);
    expect(ringWidth(2160, 3840)).toBe(30);
    expect(ringWidth(100, 50)).toBe(4);
  });

  it('draws in the approved yellow', () => {
    expect(RING_COLOR).toBe('#FFE58A');
  });
});
