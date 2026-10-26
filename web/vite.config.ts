// Vite + Vitest config for the PWA. Dev server proxies /api to the local Axum server.
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/api': { target: 'http://localhost:8080', changeOrigin: false },
    },
  },
  test: {
    environment: 'jsdom',
    include: ['src/**/*.test.{ts,tsx}'],
    // tokens.test.ts reads tokens.css?raw; Vitest blanks CSS it does not process.
    css: { include: [/tokens\.css/] },
  },
});
