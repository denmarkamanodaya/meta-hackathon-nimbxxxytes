import { describe, expect, it } from 'vitest';
import { parseAppearance, resolveTheme } from './appearance';

describe('parseAppearance', () => {
  it('reads each stored choice', () => {
    expect(parseAppearance('system')).toBe('system');
    expect(parseAppearance('light')).toBe('light');
    expect(parseAppearance('dark')).toBe('dark');
  });

  it('defaults to light when nothing or something unknown is stored', () => {
    expect(parseAppearance(null)).toBe('light');
    expect(parseAppearance('')).toBe('light');
    expect(parseAppearance('Dark')).toBe('light');
    expect(parseAppearance('midnight')).toBe('light');
  });

  it('opens light by default even when macOS is dark', () => {
    expect(resolveTheme(parseAppearance(null), true)).toBe('light');
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
