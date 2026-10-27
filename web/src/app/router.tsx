// Route table: the one place routes are declared. Pages load lazily, one chunk per route.
import { createBrowserRouter, Navigate } from 'react-router';
import { AppShell } from '../components/AppShell';
import { platform } from './compose';

/**
 * Browser router for the PWA: `/`, `/search`, `/upload`, `/shorts`, `/people`, `/editor`,
 * `/editor/:id`, `/clips/:id`, plus the platform's routes (the Mac app's `/sync`).
 */
export const router = createBrowserRouter([
  {
    path: '/',
    Component: AppShell,
    children: [
      {
        index: true,
        lazy:
          platform.pages.library ?? (async () => ({ Component: (await import('../pages/LibraryPage')).LibraryPage })),
      },
      {
        path: 'search',
        lazy: async () => ({ Component: (await import('../pages/SearchPage')).SearchPage }),
      },
      {
        path: 'upload',
        lazy: platform.pages.upload ?? (async () => ({ Component: (await import('../pages/UploadPage')).UploadPage })),
      },
      {
        path: 'editor',
        lazy: async () => ({ Component: (await import('../pages/EditorPage')).EditorPage }),
      },
      {
        path: 'shorts',
        lazy: async () => ({ Component: (await import('../pages/ShortsPage')).ShortsPage }),
      },
      {
        path: 'people',
        lazy: async () => ({ Component: (await import('../pages/PeoplePage')).PeoplePage }),
      },
      {
        path: 'editor/:id',
        lazy: async () => ({ Component: (await import('../pages/ShortPage')).ShortPage }),
      },
      {
        path: 'clips/:id',
        lazy: async () => ({
          Component: (await import('../pages/ClipDetailPage')).ClipDetailPage,
        }),
      },
      ...platform.routes,
      { path: '*', element: <Navigate to="/" replace /> },
    ],
  },
]);
