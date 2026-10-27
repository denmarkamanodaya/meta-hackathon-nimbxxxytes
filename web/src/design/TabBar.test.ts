import { describe, expect, it } from 'vitest';
import { isTabActive } from './TabBar';

describe('isTabActive', () => {
  it('matches Library only on the root', () => {
    expect(isTabActive({ to: '/' }, '/')).toBe(true);
    expect(isTabActive({ to: '/' }, '/search')).toBe(false);
  });

  it('matches a tab and its sub-pages, and extra prefixes', () => {
    expect(isTabActive({ to: '/shorts' }, '/shorts')).toBe(true);
    expect(isTabActive({ to: '/shorts', match: ['/editor'] }, '/editor/sh1')).toBe(true);
    expect(isTabActive({ to: '/people' }, '/peoplex')).toBe(false);
  });
});
