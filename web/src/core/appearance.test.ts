import { describe, expect, it } from 'vitest';
import { parseAppearance, resolveTheme } from './appearance';

describe('parseAppearance', () => {
  it('reads each stored choice', () => {
    expect(parseAppearance('system')).toBe('system');
    expect(parseAppearance('light')).toBe('light');
    expect(parseAppearance('dark')).toBe('dark');
  });

  it('defaults to system when nothing or something unknown is stored', () => {
    expect(parseAppearance(null)).toBe('system');
    expect(parseAppearance('')).toBe('system');
    expect(parseAppearance('Dark')).toBe('system');
    expect(parseAppearance('midnight')).toBe('system');
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
