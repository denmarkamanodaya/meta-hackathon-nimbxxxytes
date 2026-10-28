import { describe, expect, it } from 'vitest';
import coverSample from '../../fixtures/cover_still.sample.json';
import { CoverStillPropsSchema, titleFontSize, titlePlacement, titleWeight } from './cover.ts';

const withTitle = (text: string) => ({ ...coverSample, title: { ...coverSample.title, text } });

describe('CoverStillPropsSchema', () => {
  it('parses the shared fixture unchanged', () => {
    expect(CoverStillPropsSchema.parse(coverSample)).toEqual(coverSample);
  });

  it('takes a 1-character title at the top and a 32-character one', () => {
    expect(CoverStillPropsSchema.safeParse({ ...coverSample, title: { text: 'A', position: 'top' } }).success).toBe(true);
    expect(CoverStillPropsSchema.safeParse(withTitle('x'.repeat(32))).success).toBe(true);
  });

  it.each([
    ['an empty title', withTitle('')],
    ['a 33-character title', withTitle('x'.repeat(33))],
    ['a middle position', { ...coverSample, title: { text: 'Hi', position: 'middle' } }],
    ['a fractional width', { ...coverSample, width: 1080.5 }],
    ['a zero height', { ...coverSample, height: 0 }],
    ['a named accent', { ...coverSample, theme: { ...coverSample.theme, accent: 'teal' } }],
    ['an empty font', { ...coverSample, theme: { ...coverSample.theme, font: '' } }],
    ['no image', { ...coverSample, image_url: '' }],
  ])('rejects %s', (_label, props) => {
    expect(CoverStillPropsSchema.safeParse(props).success).toBe(false);
  });
});

describe('titleFontSize', () => {
  it('is 13 % of the width for short titles', () => {
    expect(titleFontSize('Nap', 1080)).toBe(140);
    expect(titleFontSize('Nap champion', 1080)).toBe(140);
  });

  it('shrinks for long titles to what fits on two lines between the insets', () => {
    const long = titleFontSize('The best afternoon nap of my life', 1080);
    expect(long).toBeLessThan(140);
    expect(long).toBe(Math.round((1080 * 0.84) / (17 * 0.62)));
  });

  it('keeps one long word on one line', () => {
    expect(titleFontSize('Supercalifragilistic', 1080)).toBe(Math.round((1080 * 0.84) / (20 * 0.62)));
  });

  it('scales with the width', () => {
    expect(titleFontSize('Nap', 540)).toBe(70);
  });
});

describe('titlePlacement', () => {
  it('sits 9 % from the top with 8 % side insets', () => {
    expect(titlePlacement('top', 1080, 1920)).toEqual({ left: 86, right: 86, top: 173 });
  });

  it('sits 7 % from the bottom with 8 % side insets', () => {
    expect(titlePlacement('bottom', 1080, 1920)).toEqual({ left: 86, right: 86, bottom: 134 });
  });
});

describe('titleWeight', () => {
  it('is the heaviest bundled weight of the first family in the stack', () => {
    expect(titleWeight('Geist')).toBe(600);
    expect(titleWeight("'Bricolage Grotesque', 'Geist', sans-serif")).toBe(700);
  });

  it('is 600 for a family that is not bundled', () => {
    expect(titleWeight('Comic Neue, sans-serif')).toBe(600);
  });
});
