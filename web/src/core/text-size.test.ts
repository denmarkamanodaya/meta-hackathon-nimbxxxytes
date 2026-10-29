import { describe, expect, it } from 'vitest';
import { DEFAULT_TEXT_SIZE, parseTextSize, stepTextSize, textSizeKey, textSizeLabel } from './text-size';

const key = (over: Partial<Parameters<typeof textSizeKey>[0]>) => ({ key: '', metaKey: false, ctrlKey: false, altKey: false, ...over });

describe('text size', () => {
  it('reads only a stored step, else 100%', () => {
    expect(parseTextSize('1.2')).toBe(1.2);
    expect(parseTextSize(null)).toBe(DEFAULT_TEXT_SIZE);
    expect(parseTextSize('')).toBe(DEFAULT_TEXT_SIZE);
    expect(parseTextSize('1.15')).toBe(DEFAULT_TEXT_SIZE);
    expect(parseTextSize('big')).toBe(DEFAULT_TEXT_SIZE);
  });

  it('steps up and down and holds at the ends', () => {
    expect(stepTextSize(1, 1)).toBe(1.1);
    expect(stepTextSize(1, -1)).toBe(0.9);
    expect(stepTextSize(1.3, 1)).toBe(1.3);
    expect(stepTextSize(0.85, -1)).toBe(0.85);
    expect(stepTextSize(1.15, 1)).toBe(1.1);
  });

  it('prints the percent', () => {
    expect(textSizeLabel(1.1)).toBe('110%');
    expect(textSizeLabel(0.85)).toBe('85%');
  });

  it('takes ⌘ or Ctrl with plus, minus or zero, and nothing else', () => {
    expect(textSizeKey(key({ key: '=', metaKey: true }))).toBe('up');
    expect(textSizeKey(key({ key: '+', ctrlKey: true }))).toBe('up');
    expect(textSizeKey(key({ key: '-', metaKey: true }))).toBe('down');
    expect(textSizeKey(key({ key: '0', ctrlKey: true }))).toBe('reset');
    expect(textSizeKey(key({ key: '=' }))).toBeNull();
    expect(textSizeKey(key({ key: '=', metaKey: true, altKey: true }))).toBeNull();
    expect(textSizeKey(key({ key: 'k', metaKey: true }))).toBeNull();
  });
});
