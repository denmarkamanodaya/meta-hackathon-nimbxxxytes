// When to show the "Add to Home Screen" hint: iOS Safari only (it has no install prompt), not
// already installed, and not dismissed before.

/** What the rule needs to know about the device. */
export interface DeviceInfo {
  userAgent: string;
  /** `navigator.maxTouchPoints`; iPadOS reports a Mac user agent but has touch. */
  maxTouchPoints: number;
  /** Running as an installed app (home-screen launch). */
  isStandalone: boolean;
}

/**
 * True on an iPhone, iPod or iPad (including iPadOS with a desktop user agent).
 * @param device - Device facts.
 * @returns Whether this is iOS / iPadOS.
 */
export function isIos(device: DeviceInfo): boolean {
  return /iPhone|iPad|iPod/.test(device.userAgent) || (device.userAgent.includes('Macintosh') && device.maxTouchPoints > 1);
}

/**
 * Decides whether to show the install hint.
 * @param device - Device facts.
 * @param isDismissed - The user closed the hint before.
 * @returns True on iOS in the browser (Safari or another iOS browser) when not dismissed.
 */
export function shouldShowInstallHint(device: DeviceInfo, isDismissed: boolean): boolean {
  return isIos(device) && !device.isStandalone && !isDismissed;
}
