import { describe, expect, it } from 'vitest';
import { clickToFrame, frameToElement, pictureBoxPercent, pictureRect } from './video-point';

// A 16:9 element 800 × 450 at (100, 50) on the page.
const element = { left: 100, top: 50, width: 800, height: 450 };
const wide = { width: 1920, height: 1080 };
// A 9:16 phone clip: letterboxed left and right under contain.
const tall = { width: 1080, height: 1920 };

describe('pictureRect', () => {
  it('fills the element when the aspects match', () => {
    expect(pictureRect(element, wide, 'contain')).toEqual({ left: 0, top: 0, width: 800, height: 450 });
  });

  it('pillarboxes a tall picture under contain', () => {
    const rect = pictureRect(element, tall, 'contain');

    expect(rect.height).toBe(450);
    expect(rect.width).toBeCloseTo(253.125);
    expect(rect.left).toBeCloseTo(273.4375);
  });

  it('overflows a tall picture under cover (cropped top and bottom)', () => {
    const rect = pictureRect(element, tall, 'cover');

    expect(rect.width).toBe(800);
    expect(rect.height).toBeCloseTo(1422.22, 1);
    expect(rect.top).toBeCloseTo(-486.11, 1);
  });

  it('uses the element while the size is unknown', () => {
    expect(pictureRect(element, { width: 0, height: 0 }, 'contain')).toEqual({ left: 0, top: 0, width: 800, height: 450 });
  });
});

describe('clickToFrame', () => {
  it('maps the centre and the corners of a matching picture', () => {
    expect(clickToFrame({ x: 500, y: 275 }, element, wide, 'contain')).toEqual({ x: 0.5, y: 0.5 });
    expect(clickToFrame({ x: 100, y: 50 }, element, wide, 'contain')).toEqual({ x: 0, y: 0 });
    expect(clickToFrame({ x: 900, y: 500 }, element, wide, 'contain')).toEqual({ x: 1, y: 1 });
  });

  it('measures across the picture, not the letterboxed element', () => {
    // The picture spans x 373.4375…626.5625 on the page.
    const point = clickToFrame({ x: 100 + 273.4375 + 253.125 / 4, y: 50 + 450 / 4 }, element, tall, 'contain');

    expect(point?.x).toBeCloseTo(0.25);
    expect(point?.y).toBeCloseTo(0.25);
  });

  it('refuses a click on a letterbox bar', () => {
    expect(clickToFrame({ x: 120, y: 275 }, element, tall, 'contain')).toBeNull();
    expect(clickToFrame({ x: 880, y: 275 }, element, tall, 'contain')).toBeNull();
  });

  it('accounts for the cropped part under cover', () => {
    // The visible middle band of a tall picture: the element's top edge is 486 px into the picture.
    const top = clickToFrame({ x: 500, y: 50 }, element, tall, 'cover');

    expect(top?.x).toBeCloseTo(0.5);
    expect(top?.y).toBeCloseTo(486.11 / 1422.22, 3);
    expect(clickToFrame({ x: 500, y: 275 }, element, tall, 'cover')?.y).toBeCloseTo(0.5);
  });
});

describe('pictureBoxPercent', () => {
  it('places a frame-pixel outline over the letterboxed picture', () => {
    const box = pictureBoxPercent(element, tall, 'contain');

    expect(box.top).toBe(0);
    expect(box.height).toBe(100);
    expect(box.left).toBeCloseTo((273.4375 / 800) * 100);
    expect(box.width).toBeCloseTo((253.125 / 800) * 100);
  });

  it('runs past the element under cover', () => {
    const box = pictureBoxPercent(element, tall, 'cover');

    expect(box.width).toBe(100);
    expect(box.top).toBeLessThan(0);
    expect(box.height).toBeGreaterThan(100);
  });
});

describe('frameToElement', () => {
  it('is the inverse of clickToFrame', () => {
    const point = frameToElement({ x: 0.25, y: 0.75 }, element, tall, 'contain');
    const back = clickToFrame({ x: point.x + element.left, y: point.y + element.top }, element, tall, 'contain');

    expect(back?.x).toBeCloseTo(0.25);
    expect(back?.y).toBeCloseTo(0.75);
  });
});
