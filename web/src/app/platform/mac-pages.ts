// The pages the Mac layout draws its own way, shared by the Mac app and the wide-screen PWA (a
// browser window that shows the same sidebar and pages). Each is lazy, so the phone PWA never
// downloads them.
import type { RouteObject } from 'react-router';
import type { Platform } from './types';

/** Every Mac page. */
export const MAC_PAGES: Platform['pages'] = {
  library: async () => ({ Component: (await import('../../pages/desktop/MacLibraryPage')).MacLibraryPage }),
  upload: async () => ({ Component: (await import('../../pages/desktop/MacUploadRedirect')).MacUploadRedirect }),
  search: async () => ({ Component: (await import('../../pages/desktop/MacSearchRedirect')).MacSearchRedirect }),
  people: async () => ({ Component: (await import('../../pages/desktop/MacFacesPage')).MacFacesPage }),
  clip: async () => ({ Component: (await import('../../pages/desktop/MacClipPage')).MacClipPage }),
  short: async () => ({ Component: (await import('../../pages/desktop/MacShortPage')).MacShortPage }),
  publish: async () => ({ Component: (await import('../../pages/desktop/MacPublishPage')).MacPublishPage }),
  shorts: async () => ({ Component: (await import('../../pages/desktop/MacShortsPage')).MacShortsPage }),
  guides: async () => ({ Component: (await import('../../pages/desktop/MacGuidesPage')).MacGuidesPage }),
  guide: async () => ({ Component: (await import('../../pages/desktop/MacGuidePage')).MacGuidePage }),
  iread: async () => ({ Component: (await import('../../pages/desktop/MacIReadPage')).MacIReadPage }),
  ireadDocument: async () => ({ Component: (await import('../../pages/desktop/MacIReadDocumentPage')).MacIReadDocumentPage }),
};

/** The Mac pages a browser shows: Upload stays the PWA's own page, since a browser has no native file engine. */
export const BROWSER_MAC_PAGES: Platform['pages'] = Object.fromEntries(Object.entries(MAC_PAGES).filter(([page]) => page !== 'upload'));

/** A project's page, a route of its own under the shell. */
export const MAC_PROJECT_ROUTE: RouteObject = {
  path: 'projects/:id',
  lazy: async () => ({ Component: (await import('../../pages/desktop/MacProjectPage')).MacProjectPage }),
};
