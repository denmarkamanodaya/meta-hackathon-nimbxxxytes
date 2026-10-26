// Entry point: global styles, providers, router and (in production) the service worker.
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { RouterProvider } from 'react-router';
import { env } from './app/env';
import { Providers } from './app/providers';
import { registerServiceWorker } from './app/register-sw';
import { router } from './app/router';
import './design/tokens.css';
import './design/base.css';

const rootElement = document.getElementById('root');
if (rootElement === null) throw new Error('index.html is missing #root');

createRoot(rootElement).render(
  <StrictMode>
    <Providers>
      <RouterProvider router={router} />
    </Providers>
  </StrictMode>,
);

if (env.isProd) registerServiceWorker();
