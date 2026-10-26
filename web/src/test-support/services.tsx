// Test doubles for the services context and a tiny renderer for hook tests (no Testing Library).
import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { vi } from 'vitest';
import type { ApiClient } from '../services/api/client';
import { createSessionStore } from '../services/session/session-store';
import type { UploadQueue } from '../services/upload/queue';
import { ServicesContext, type Services } from '../hooks/services-context';

/** An ApiClient whose every method rejects until a test stubs it. */
export function fakeApi(overrides: Partial<ApiClient> = {}): ApiClient {
  const unstubbed = () => Promise.reject(new Error('not stubbed'));
  return {
    getHealth: vi.fn(unstubbed),
    createSession: vi.fn(unstubbed),
    createUpload: vi.fn(unstubbed),
    presignParts: vi.fn(unstubbed),
    completeUpload: vi.fn(unstubbed),
    listClips: vi.fn(unstubbed),
    getClip: vi.fn(unstubbed),
    ...overrides,
  };
}

/** Full services value with fakes; override what the test exercises. */
export function fakeServices(overrides: Partial<Services> = {}): Services {
  const uploads: UploadQueue = {
    subscribe: () => () => undefined,
    getSnapshot: () => [],
    add: vi.fn(),
    retry: vi.fn(),
  };
  return {
    api: fakeApi(),
    session: createSessionStore(),
    uploads,
    wakeLock: { setActive: vi.fn(), dispose: vi.fn() },
    events: () => () => undefined,
    ...overrides,
  };
}

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/** A mounted tree inside the services provider. */
export interface Mounted {
  container: HTMLDivElement;
  unmount(): void;
}

/**
 * Renders `node` inside `ServicesContext` and lets pending promises settle.
 * @param node - Usually a probe component that calls the hook under test.
 * @param services - The services value.
 * @returns The container and an unmount function.
 */
export async function mount(node: ReactNode, services: Services): Promise<Mounted> {
  const container = document.createElement('div');
  document.body.append(container);
  const root: Root = createRoot(container);
  await act(async () => {
    root.render(<ServicesContext value={services}>{node}</ServicesContext>);
    await Promise.resolve();
  });
  return {
    container,
    unmount: () => {
      act(() => {
        root.unmount();
      });
      container.remove();
    },
  };
}
