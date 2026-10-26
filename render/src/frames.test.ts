import { describe, expect, it } from 'vitest';
import sample from '../fixtures/props.sample.json';
import { ShortPropsSchema, type ShortProps } from './composition/schema.ts';
import {
  activeCaption,
  activeWordIndex,
  clipTimings,
  deriveProps,
  outputSize,
  shotLabel,
  stageScale,
  totalFrames,
} from './frames.ts';

const props: ShortProps = ShortPropsSchema.parse(sample);

describe('ShortPropsSchema', () => {
  it('accepts the shared fixture', () => {
    expect(ShortPropsSchema.safeParse(sample).success).toBe(true);
  });

  it('rejects a bad aspect, negative times, out before in, and a zoom below 1', () => {
    const clip = props.clips[0];
    const bad = (patch: object) => ShortPropsSchema.safeParse({ ...props, ...patch }).success;

    expect(bad({ aspect: '9:16' })).toBe(false);
    expect(bad({ clips: [{ ...clip, in_s: -1 }] })).toBe(false);
    expect(bad({ clips: [{ ...clip, in_s: 5, out_s: 4 }] })).toBe(false);
    expect(bad({ clips: [{ ...clip, punch_in: 0.9 }] })).toBe(false);
    expect(bad({ clips: [] })).toBe(false);
  });
});

describe('frame maths', () => {
  it('lays clips end to end from their in/out at 30 fps', () => {
    expect(clipTimings(props.clips, 30)).toEqual([
      { from: 0, durationInFrames: 105, trimBefore: 90 },
      { from: 105, durationInFrames: 120, trimBefore: 930 },
      { from: 225, durationInFrames: 105, trimBefore: 1380 },
      { from: 330, durationInFrames: 75, trimBefore: 1830 },
    ]);
  });

  it('counts the end card in the total duration', () => {
    expect(totalFrames(props)).toBe(405 + 30);
    expect(totalFrames({ ...props, end_card_s: 0 })).toBe(405);
  });

  it('gives every clip at least one frame', () => {
    expect(clipTimings([{ in_s: 1, out_s: 1.001 }], 30)[0]?.durationInFrames).toBe(1);
  });

  it('renders previews at even sizes: 544×680 for 4:5 and 540×540 for 1:1', () => {
    expect(outputSize('4:5', 'preview')).toEqual({ width: 544, height: 680 });
    expect(outputSize('1:1', 'preview')).toEqual({ width: 540, height: 540 });
    expect(outputSize('4:5', 'final')).toEqual({ width: 1080, height: 1350 });
    expect(outputSize('1:1', 'final')).toEqual({ width: 1080, height: 1080 });
    expect(stageScale(544)).toBeCloseTo(0.5037, 4);
    expect(stageScale(1080)).toBe(1);
  });
});

describe('caption visibility', () => {
  const captions = props.clips[0]?.captions ?? [];

  it('shows a phrase from its start until (not including) its end, in source seconds', () => {
    expect(activeCaption(captions, 1.1)).toBeNull();
    expect(activeCaption(captions, 1.2)?.text).toBe('Okay, latte art attempt');
    expect(activeCaption(captions, 3.0)).toBeNull();
    expect(activeCaption(captions, 3.5)?.text).toBe('that one looks like a heart');
  });

  it('shows the phrase live at the first frame of a clip that starts inside it', () => {
    // Clip 1 starts at in_s 3.0; frame 15 of the clip is source 3.5.
    expect(activeCaption(captions, 3.0 + 15 / 30)?.text).toBe('that one looks like a heart');
  });

  it('marks the last word whose time has passed', () => {
    const phrase = captions[1];
    if (phrase === undefined) throw new Error('fixture needs two phrases');

    expect(activeWordIndex(phrase, 3.3)).toBe(-1);
    expect(activeWordIndex(phrase, 3.4)).toBe(0);
    expect(activeWordIndex(phrase, 4.5)).toBe(3);
  });
});

describe('deriveProps', () => {
  it('follows the edited order, in/out and zoom, keeping each shot\'s source and captions', () => {
    const derived = deriveProps(props, [
      { segment_id: 'seg_desk', in: 61.5, out: 63.0, punch_in: 1.2, subject: 'laptop' },
      { segment_id: 'seg_coffee', in: 2.0, out: 6.0, punch_in: 1, subject: 'the latte pour' },
    ]);

    expect(derived.clips.map((c) => [c.segment_id, c.in_s, c.out_s, c.punch_in])).toEqual([
      ['seg_desk', 61.5, 63.0, 1.2],
      ['seg_coffee', 2.0, 6.0, 1],
    ]);
    expect(derived.clips[1]?.src_url).toBe(props.clips[0]?.src_url);
    expect(derived.clips[1]?.captions).toBe(props.clips[0]?.captions);
    expect(totalFrames(derived)).toBe(45 + 120 + 30);
  });

  it('drops a clip whose segment the props do not know', () => {
    expect(deriveProps(props, [{ segment_id: 'seg_x', in: 0, out: 1, punch_in: 1, subject: null }]).clips).toEqual([]);
  });
});

describe('shotLabel', () => {
  it('uses the subject, else "Shot N", never the segment id', () => {
    expect(shotLabel({ subject: 'the crossing' }, 2)).toBe('the crossing');
    expect(shotLabel({ subject: null }, 1)).toBe('Shot 2');
  });
});
