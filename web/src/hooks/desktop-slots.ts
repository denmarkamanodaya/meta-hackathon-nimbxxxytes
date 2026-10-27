// The Mac app's extra UI, handed to the shared shell and pages through context by the desktop
// platform (src/app/platform/desktop.tsx). The PWA provides none, so its pages render nothing
// extra and its bundle holds none of this UI.
import { createContext, useContext, type ComponentType } from 'react';
import type { ShortListItem } from '../services/api/types';

/** Desktop-only pieces the shared shell and pages place. */
export interface DesktopSlots {
  /** Left sidebar that replaces the bottom tab bar (M1–M3). */
  Sidebar: ComponentType;
  /** First-run and locked-session screen (M4), in place of the passcode screen. */
  SignIn: ComponentType;
  /** Clip page "Make available offline" switch. */
  ClipOffline: ComponentType<{ clipId: string }>;
  /** Studio › Shorts inspector beside the grid (M4): score, editor's note, Final Cut / Finder. */
  ShortInspector: ComponentType<{ item: ShortListItem; onDeleted: () => void }>;
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
