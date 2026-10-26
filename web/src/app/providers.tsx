// App providers: binds composed services into React context for hooks.
import type { ReactNode } from 'react';
import { ServicesContext } from '../hooks/services-context';
import { services } from './compose';

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
  return <ServicesContext value={services}>{children}</ServicesContext>;
}
