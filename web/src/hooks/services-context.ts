// React context that carries the composed services from src/app/ to hooks. Hooks never build
// adapters themselves, so tests swap any service by providing a different value.
import { createContext, useContext } from 'react';
import type { ApiClient } from '../services/api/client';
import type { SessionStore } from '../services/session/session-store';
import type { UploadQueue } from '../services/upload/queue';
import type { WakeLockKeeper } from '../services/wake-lock';

/** Every service a hook may use, bound once by the composition root. */
export interface Services {
  api: ApiClient;
  session: SessionStore;
  uploads: UploadQueue;
  wakeLock: WakeLockKeeper;
}

/** Holds the bound services; `src/app/providers.tsx` supplies the value. */
export const ServicesContext = createContext<Services | null>(null);

/**
 * Returns the services from context.
 * @returns The services the composition root bound.
 * @throws Error when no `ServicesContext` provider wraps the caller (a wiring bug).
 */
export function useServices(): Services {
  const services = useContext(ServicesContext);
  if (services === null) throw new Error('useServices called outside ServicesContext provider');
  return services;
}
