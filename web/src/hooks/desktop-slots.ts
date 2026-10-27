// The Mac app's extra UI, handed to the shared shell and pages through context by the desktop
// platform (src/app/platform/desktop.tsx). The PWA provides none, so its pages render nothing
// extra and its bundle holds none of this UI.
import { createContext, useContext, type ComponentType } from 'react';
import type { ShotNames } from '../core/humanize';
import type { ShortDetail, ShortVersion } from '../services/api/types';

/** Desktop-only pieces the shared shell and pages place. */
export interface DesktopSlots {
  /** Left sidebar that replaces the bottom tab bar (M1–M3). */
  Sidebar: ComponentType;
  /** First-run and locked-session screen (M4), in place of the passcode screen. */
  SignIn: ComponentType;
  /** Clip page "Make available offline" switch. */
  ClipOffline: ComponentType<{ clipId: string }>;
  /** Short page right column (M2): "Finish it on your Mac" and "In the timeline". */
  ShortFinish: ComponentType<{ detail: ShortDetail; shown: ShortVersion; names: ShotNames }>;
  /** Short page score row under the Player (M2): "Draft 1 25/50 → Draft 2 43/50", Accepted. */
  ShortScore: ComponentType<{ shown: ShortVersion; first: ShortVersion | null }>;
}

/** Holds the slots; null in the PWA. */
export const DesktopSlotsContext = createContext<DesktopSlots | null>(null);

/**
 * Returns the desktop slots.
 * @returns The slots in the Mac app, null in the PWA.
 */
export function useDesktopSlots(): DesktopSlots | null {
  return useContext(DesktopSlotsContext);
}
