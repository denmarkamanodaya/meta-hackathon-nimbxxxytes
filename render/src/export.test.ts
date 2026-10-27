import { describe, expect, it } from 'vitest';
import sample from '../fixtures/props.sample.json';
import { ShortPropsSchema } from './composition/schema.ts';
import { dimensions, frameAspect, outputSize } from './frames.ts';

describe('export frames', () => {
  it('draw 9:16 at 1080×1920, 540×960 for a preview', () => {
    expect(dimensions('9:16')).toEqual({ width: 1080, height: 1920 });
    expect(outputSize('9:16', 'final')).toEqual({ width: 1080, height: 1920 });
    expect(outputSize('9:16', 'preview')).toEqual({ width: 540, height: 960 });
  });

  it("use the export frame when the props carry one, else the short's own", () => {
    const props = ShortPropsSchema.parse(sample);
    expect(frameAspect(props)).toBe('4:5');
    expect(frameAspect({ ...props, export_aspect: '9:16' })).toBe('9:16');
  });

  it('take 9:16 only as the optional export field, never as the short aspect', () => {
    expect('export_aspect' in sample).toBe(false);
    expect(ShortPropsSchema.safeParse({ ...sample, export_aspect: '9:16' }).success).toBe(true);
    expect(ShortPropsSchema.safeParse({ ...sample, aspect: '9:16' }).success).toBe(false);
    expect(ShortPropsSchema.safeParse({ ...sample, export_aspect: '16:9' }).success).toBe(false);
  });
});
