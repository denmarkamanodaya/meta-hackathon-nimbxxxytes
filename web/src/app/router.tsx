// Route table: the one place routes are declared. Pages load lazily, one chunk per route.
import { createBrowserRouter, Navigate } from 'react-router';
import { AppShell } from '../components/AppShell';
import { platform } from './compose';

/**
 * Browser router for the PWA: `/`, `/search`, `/upload`, `/shorts`, `/people`, `/editor`,
 * `/editor/:id`, `/editor/:id/finish`, `/editor/:id/publish`, `/clips/:id`, `/guides`,
 * `/guides/:id`, `/guides/:id/step/:n`, plus the platform's routes (the Mac app's `/sync`).
 * Productions were removed (owner ruling 2026-10-29): `/productions` and everything under it
 * redirect to `/shorts`, so old links and bookmarks never land on a dead page.
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
      { path: 'productions/*', element: <Navigate to="/shorts" replace /> },
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
      {
        path: 'guides',
        lazy: platform.pages.guides ?? (async () => ({ Component: (await import('../pages/GuidesPage')).GuidesPage })),
      },
      {
        path: 'guides/:id',
        lazy: platform.pages.guide ?? (async () => ({ Component: (await import('../pages/GuidePage')).GuidePage })),
      },
      {
        path: 'guides/:id/step/:n',
        lazy: async () => ({ Component: (await import('../pages/GuideStepPage')).GuideStepPage }),
      },
      ...platform.routes,
      { path: '*', element: <Navigate to="/" replace /> },
    ],
  },
]);
