// Registers the app-shell service worker (public/sw.js) in production builds only.

/**
 * Registers `/sw.js` after load when the browser supports service workers.
 * Registration failure is logged and ignored: the app works without offline caching.
 */
export function registerServiceWorker(): void {
  if (!('serviceWorker' in navigator)) return;
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch((error: unknown) => {
      // Recovers: offline caching is optional; the app still runs online.
      console.warn('service worker registration failed', error);
    });
  });
}
