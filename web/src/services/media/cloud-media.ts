// PWA media: plays every file from the cloud URL the API returned, exactly as before the Mac app.
import type { MediaResolver } from '../../core/ports/media-resolver';

/** Resolves each media file to its own cloud URL. */
export const cloudMediaResolver: MediaResolver = {
  immediate: ({ cloudUrl }) => cloudUrl,
  resolve: ({ cloudUrl }) => Promise.resolve(cloudUrl),
};
