// PWA platform: same-origin fetch and EventSource, cloud media URLs, no native features.
import { createFetchTransport } from '../../services/api/fetch-transport';
import { cloudMediaResolver } from '../../services/media/cloud-media';
import type { Platform, PlatformOptions } from './types';

/**
 * Builds the PWA platform.
 * @param options - API base and timeout.
 * @returns The platform.
 */
export function createPlatform(options: PlatformOptions): Platform {
  return {
    transport: createFetchTransport({ baseUrl: options.apiBase, timeoutMs: options.timeoutMs }),
    media: cloudMediaResolver,
    desktop: null,
    slots: null,
    routes: [],
    pages: {},
  };
}
