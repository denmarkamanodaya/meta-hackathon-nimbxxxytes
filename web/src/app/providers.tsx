// App providers: binds composed services (and, in the Mac app, the desktop UI slots) into React
// context for hooks and pages.
import type { ReactNode } from 'react';
import { DesktopSlotsContext } from '../hooks/desktop-slots';
import { ServicesContext } from '../hooks/services-context';
import { platform, services } from './compose';

/** Props for `Providers`. */
export interface ProvidersProps {
  /** The app tree. */
  children: ReactNode;
}

/**
 * Supplies the services to every hook below it.
 * @param props - See `ProvidersProps`.
 * @returns The provider tree.
 */
export function Providers({ children }: ProvidersProps) {
  return (
    <ServicesContext value={services}>
      <DesktopSlotsContext value={platform.slots}>{children}</DesktopSlotsContext>
    </ServicesContext>
  );
}
