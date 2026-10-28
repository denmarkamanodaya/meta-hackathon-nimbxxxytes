import { describe, expect, it } from 'vitest';
import { costLine, formatPrice, imagesPrice, MUSE_COST } from './muse-image';

describe('Muse Image cost lines', () => {
  it('prices in whole cents', () => {
    expect(formatPrice(0.01)).toBe('$0.01');
    expect(formatPrice(0.03)).toBe('$0.03');
    expect(formatPrice(0.1 + 0.2)).toBe('$0.30');
    expect(imagesPrice(3)).toBe('$0.03');
  });

  it('reads as the boards print them', () => {
    expect(costLine(1)).toBe('$0.01 · about 15 s');
    expect(MUSE_COST).toEqual({
      moreCovers: '$0.03 · about 15 s',
      redrawCover: '$0.01 · about 15 s',
      footageBoard: '$0.01 · about 15 s · uses the moment’s hook frame',
      newArt: 'New art · $0.01',
    });
  });
});
