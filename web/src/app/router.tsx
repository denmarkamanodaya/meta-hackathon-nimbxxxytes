// Route table: the one place routes are declared. Pages load lazily, one chunk per route.
import { createBrowserRouter, Navigate } from 'react-router';
import { AppShell } from '../components/AppShell';
import { platform } from './compose';

/**
 * Browser router for the PWA: `/`, `/search`, `/upload`, `/shorts`, `/productions`,
 * `/productions/new`, `/productions/:id`, `/people`, `/editor`, `/editor/:id`,
 * `/editor/:id/finish`, `/editor/:id/publish`, `/clips/:id`, plus the platform's routes (the
 * Mac app's `/sync`).
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
        lazy: platform.pages.search ?? (async () => ({ Component: (await import('../pages/SearchPage')).SearchPage })),
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
        lazy: platform.pages.shorts ?? (async () => ({ Component: (await import('../pages/ShortsPage')).ShortsPage })),
      },
      {
        path: 'productions',
        lazy:
          platform.pages.productions ??
          (async () => ({ Component: (await import('../pages/ProductionsPage')).ProductionsPage })),
      },
      {
        path: 'productions/new',
        lazy:
          platform.pages.newProduction ??
          (async () => ({ Component: (await import('../pages/NewProductionPage')).NewProductionPage })),
      },
      {
        path: 'productions/:id',
        lazy:
          platform.pages.production ??
          (async () => ({ Component: (await import('../pages/ProductionPage')).ProductionPage })),
      },
      {
        path: 'people',
        lazy: platform.pages.people ?? (async () => ({ Component: (await import('../pages/PeoplePage')).PeoplePage })),
      },
      {
        path: 'editor/:id',
        lazy: platform.pages.short ?? (async () => ({ Component: (await import('../pages/ShortPage')).ShortPage })),
      },
      {
        path: 'editor/:id/finish',
        lazy: async () => ({ Component: (await import('../pages/FinishPage')).FinishPage }),
      },
      {
        path: 'editor/:id/publish',
        lazy:
          platform.pages.publish ?? (async () => ({ Component: (await import('../pages/PublishPage')).PublishPage })),
      },
      {
        path: 'clips/:id',
        lazy:
          platform.pages.clip ??
          (async () => ({
            Component: (await import('../pages/ClipDetailPage')).ClipDetailPage,
          })),
      },
      ...platform.routes,
      { path: '*', element: <Navigate to="/" replace /> },
    ],
  },
]);
