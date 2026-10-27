import { describe, expect, it } from 'vitest';
import { isDesktopBrowser, shouldShowInstallHint, type DeviceInfo } from './install-hint';

const iphone = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile/15E148 Safari/604.1';
const mac = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Version/18.0 Safari/605.1.15';
const android = 'Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 Chrome/130.0 Mobile Safari/537.36';
const device = (userAgent: string, maxTouchPoints = 5, isStandalone = false): DeviceInfo => ({
  userAgent,
  maxTouchPoints,
  isStandalone,
});

describe('shouldShowInstallHint', () => {
  it('shows on an iPhone in the browser', () => {
    expect(shouldShowInstallHint(device(iphone), false)).toBe(true);
  });

  it('shows on an iPad that reports a Mac user agent, but not on a real Mac', () => {
    expect(shouldShowInstallHint(device(mac, 5), false)).toBe(true);
    expect(shouldShowInstallHint(device(mac, 0), false)).toBe(false);
  });

  it('hides once installed, once dismissed, and on Android', () => {
    expect(shouldShowInstallHint(device(iphone, 5, true), false)).toBe(false);
    expect(shouldShowInstallHint(device(iphone), true)).toBe(false);
    expect(shouldShowInstallHint(device(android), false)).toBe(false);
  });
});

describe('isDesktopBrowser', () => {
  const device = (userAgent: string, maxTouchPoints = 0) => ({ userAgent, maxTouchPoints, isStandalone: false });

  it('is true for Safari and Chrome on a Mac and Chrome on Windows', () => {
    expect(isDesktopBrowser(device('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Version/18.0 Safari/605.1.15'))).toBe(true);
    expect(isDesktopBrowser(device('Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/130.0 Safari/537.36'))).toBe(true);
  });

  it('is false for an iPhone, an iPad that reports a Mac user agent, and Android', () => {
    expect(isDesktopBrowser(device('Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) Mobile/15E148'))).toBe(false);
    expect(isDesktopBrowser(device('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Safari/605.1.15', 5))).toBe(false);
    expect(isDesktopBrowser(device('Mozilla/5.0 (Linux; Android 15; Pixel 9) Chrome/130.0 Mobile Safari/537.36'))).toBe(false);
  });
});
