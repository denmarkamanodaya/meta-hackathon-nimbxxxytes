import { describe, expect, it } from 'vitest';
import {
  bufferedPercent,
  hoverLine,
  markIn,
  markOut,
  momentCaption,
  nextMomentStart,
  nextShuttle,
  nextSpeed,
  playerKeyAction,
  previousMomentStart,
  rangeLine,
  rangeSpan,
  spansInRange,
  speedLabel,
} from './player';

const moments = [
  { start_s: 0, end_s: 7, description: 'Coffee' },
  { start_s: 7, end_s: 14, description: null },
  { start_s: 14, end_s: 22, description: 'A woman in glasses sits on a loveseat' },
];

const key = (k: string, mods: Partial<{ metaKey: boolean; ctrlKey: boolean; altKey: boolean }> = {}) => ({
  key: k,
  metaKey: false,
  ctrlKey: false,
  altKey: false,
  ...mods,
});

describe('speeds', () => {
  it('labels a rate the way the mock writes it', () => {
    expect(speedLabel(1)).toBe('1×');
    expect(speedLabel(0.75)).toBe('0.75×');
    expect(speedLabel(2)).toBe('2×');
  });

  it('cycles 0.5× … 2× and wraps; an unknown rate goes to 1×', () => {
    expect(nextSpeed(0.5)).toBe(0.75);
    expect(nextSpeed(1.5)).toBe(2);
    expect(nextSpeed(2)).toBe(0.5);
    expect(nextSpeed(3)).toBe(1);
  });
});

describe('nextShuttle', () => {
  it('L plays forward and doubles up to 4×', () => {
    expect(nextShuttle(0, 'l')).toBe(1);
    expect(nextShuttle(1, 'l')).toBe(2);
    expect(nextShuttle(2, 'l')).toBe(4);
    expect(nextShuttle(4, 'l')).toBe(4);
  });

  it('J plays backward and doubles down to −4×', () => {
    expect(nextShuttle(0, 'j')).toBe(-1);
    expect(nextShuttle(-1, 'j')).toBe(-2);
    expect(nextShuttle(-4, 'j')).toBe(-4);
  });

  it('a press against the direction restarts at 1× that way; K stops', () => {
    expect(nextShuttle(4, 'j')).toBe(-1);
    expect(nextShuttle(-2, 'l')).toBe(1);
    expect(nextShuttle(2, 'k')).toBe(0);
  });
});

describe('playerKeyAction', () => {
  it('maps the keys listed under the player', () => {
    expect(playerKeyAction(key(' '))).toEqual({ kind: 'toggle-play' });
    expect(playerKeyAction(key('J'))).toEqual({ kind: 'shuttle', key: 'j' });
    expect(playerKeyAction(key('k'))).toEqual({ kind: 'shuttle', key: 'k' });
    expect(playerKeyAction(key('l'))).toEqual({ kind: 'shuttle', key: 'l' });
    expect(playerKeyAction(key('ArrowLeft'))).toEqual({ kind: 'nudge', seconds: -5 });
    expect(playerKeyAction(key('ArrowRight'))).toEqual({ kind: 'nudge', seconds: 5 });
    expect(playerKeyAction(key(','))).toEqual({ kind: 'frame', frames: -1 });
    expect(playerKeyAction(key('.'))).toEqual({ kind: 'frame', frames: 1 });
    expect(playerKeyAction(key('i'))).toEqual({ kind: 'mark-in' });
    expect(playerKeyAction(key('O'))).toEqual({ kind: 'mark-out' });
    expect(playerKeyAction(key('c'))).toEqual({ kind: 'captions' });
    expect(playerKeyAction(key('m'))).toEqual({ kind: 'next-moment' });
  });

  it('leaves other keys and anything with ⌘, Ctrl or Alt to the app', () => {
    expect(playerKeyAction(key('x'))).toBeNull();
    expect(playerKeyAction(key('k', { metaKey: true }))).toBeNull();
    expect(playerKeyAction(key(',', { metaKey: true }))).toBeNull();
    expect(playerKeyAction(key('c', { ctrlKey: true }))).toBeNull();
    expect(playerKeyAction(key('l', { altKey: true }))).toBeNull();
  });
});

describe('moment stepping', () => {
  it('next goes to the first moment starting after now; none after the last', () => {
    expect(nextMomentStart(moments, 3)).toBe(7);
    expect(nextMomentStart(moments, 7)).toBe(14);
    expect(nextMomentStart(moments, 20)).toBeNull();
  });

  it('previous restarts the moment playing, or goes back one in its first second', () => {
    expect(previousMomentStart(moments, 10)).toBe(7);
    expect(previousMomentStart(moments, 7.5)).toBe(0);
    expect(previousMomentStart(moments, 0.5)).toBeNull();
  });

  it('captions the moment playing with its number and description', () => {
    expect(momentCaption(moments, 15)).toEqual({ label: 'Moment 3', text: 'A woman in glasses sits on a loveseat' });
    expect(momentCaption(moments, 8)).toEqual({ label: 'Moment 2', text: '' });
    expect(momentCaption(moments, 30)).toBeNull();
  });
});

describe('in and out', () => {
  it('sets each point and drops the other when it would end up on the wrong side', () => {
    expect(markIn({ inS: null, outS: null }, 63)).toEqual({ inS: 63, outS: null });
    expect(markOut({ inS: 63, outS: null }, 76)).toEqual({ inS: 63, outS: 76 });
    expect(markIn({ inS: 63, outS: 76 }, 80)).toEqual({ inS: 80, outS: null });
    expect(markOut({ inS: 63, outS: 76 }, 50)).toEqual({ inS: null, outS: 50 });
  });

  it('is a span only with both points in order', () => {
    expect(rangeSpan({ inS: 63, outS: 76 })).toEqual({ start_s: 63, end_s: 76 });
    expect(rangeSpan({ inS: 63, outS: null })).toBeNull();
    expect(rangeSpan({ inS: 63, outS: 63 })).toBeNull();
  });

  it('says how long the range runs, or which key comes next', () => {
    expect(rangeLine({ inS: 63, outS: 76 })).toBe('13 s selected');
    expect(rangeLine({ inS: null, outS: null })).toBe('Press I to set the in point');
    expect(rangeLine({ inS: 63, outS: null })).toBe('Press O to set the out point');
  });

  it('hands over every moment the range touches, and none it only borders', () => {
    expect(spansInRange(moments, { start_s: 5, end_s: 15 }).map((m) => m.start_s)).toEqual([0, 7, 14]);
    expect(spansInRange(moments, { start_s: 7, end_s: 14 }).map((m) => m.start_s)).toEqual([7]);
  });
});

describe('bufferedPercent', () => {
  it('reaches the end of the buffered range that holds now', () => {
    expect(bufferedPercent([[0, 85]], 69, 327)).toBeCloseTo(26, 0);
    expect(bufferedPercent([[0, 10], [60, 100]], 69, 200)).toBe(50);
  });

  it('is 0 outside any range or without a duration', () => {
    expect(bufferedPercent([[0, 10]], 69, 327)).toBe(0);
    expect(bufferedPercent([[0, 10]], 5, Number.NaN)).toBe(0);
  });
});

describe('hoverLine', () => {
  const turns = [{ start_s: 164, end_s: 170 }];

  it('says speech while someone talks, else the moment number, else the time alone', () => {
    expect(hoverLine(164.2, moments, turns)).toBe('2:44 · speech');
    expect(hoverLine(9, moments, turns)).toBe('0:09 · moment 2');
    expect(hoverLine(100, moments, turns)).toBe('1:40');
  });
});
