import { describe, expect, it } from 'vitest';
import { parseAppearance, resolveTheme } from './appearance';

describe('parseAppearance', () => {
  it('reads each stored choice', () => {
    expect(parseAppearance('system')).toBe('system');
    expect(parseAppearance('light')).toBe('light');
    expect(parseAppearance('dark')).toBe('dark');
  });

  it('defaults to dark (Night) when nothing or something unknown is stored', () => {
    expect(parseAppearance(null)).toBe('dark');
    expect(parseAppearance('')).toBe('dark');
    expect(parseAppearance('Dark')).toBe('dark');
    expect(parseAppearance('midnight')).toBe('dark');
  });

  it('opens dark by default even when macOS is light', () => {
    expect(resolveTheme(parseAppearance(null), false)).toBe('dark');
  });

  it('keeps a saved light choice over the dark default', () => {
    expect(resolveTheme(parseAppearance('light'), true)).toBe('light');
  });
});

describe('resolveTheme', () => {
  it('follows macOS on system', () => {
    expect(resolveTheme('system', true)).toBe('dark');
    expect(resolveTheme('system', false)).toBe('light');
  });

  it('keeps an explicit choice whatever macOS does', () => {
    expect(resolveTheme('dark', false)).toBe('dark');
    expect(resolveTheme('light', true)).toBe('light');
  });
});
