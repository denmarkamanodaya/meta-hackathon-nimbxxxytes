import { describe, expect, it } from 'vitest';
import { belowButton, clampMenu } from './menu-position';

describe('belowButton', () => {
  it('aligns the right edges and opens just below', () => {
    expect(belowButton({ left: 330, top: 16, right: 374, bottom: 60 }, 280, 8)).toEqual({ x: 94, y: 68 });
  });
});

describe('clampMenu', () => {
  const size = { width: 280, height: 120 };
  const window = { width: 390, height: 844 };

  it('leaves a menu that fits where it is', () => {
    expect(clampMenu({ x: 94, y: 68 }, size, window, 8)).toEqual({ x: 94, y: 68 });
  });

  it('moves a right-click menu left and up so it stays inside the window', () => {
    expect(clampMenu({ x: 300, y: 800 }, size, window, 8)).toEqual({ x: 102, y: 716 });
  });

  it('never goes past the top-left margin, even when the window is too small', () => {
    expect(clampMenu({ x: -40, y: -10 }, size, window, 8)).toEqual({ x: 8, y: 8 });
    expect(clampMenu({ x: 50, y: 50 }, size, { width: 200, height: 100 }, 8)).toEqual({ x: 8, y: 8 });
  });
});
