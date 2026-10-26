// Route table: the one place routes are declared. Pages load lazily, one chunk per route.
import { createBrowserRouter, Navigate } from 'react-router';
import { AppShell } from '../components/AppShell';

/**
 * Browser router for the PWA: `/`, `/search`, `/upload`, `/editor`, `/editor/:id`, `/clips/:id`.
 */
export const router = createBrowserRouter([
  {
    path: '/',
    Component: AppShell,
    children: [
      {
        index: true,
        lazy: async () => ({ Component: (await import('../pages/LibraryPage')).LibraryPage }),
      },
      {
        path: 'search',
        lazy: async () => ({ Component: (await import('../pages/SearchPage')).SearchPage }),
      },
      {
        path: 'upload',
        lazy: async () => ({ Component: (await import('../pages/UploadPage')).UploadPage }),
      },
      {
        path: 'editor',
        lazy: async () => ({ Component: (await import('../pages/EditorPage')).EditorPage }),
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
      { path: '*', element: <Navigate to="/" replace /> },
    ],
  },
]);
