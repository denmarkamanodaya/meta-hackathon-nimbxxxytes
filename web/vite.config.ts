// Vite + Vitest config for the PWA. Dev server proxies /api to the local Axum server.
// `vite --mode mock` (npm run dev:mock) instead answers /api from fixtures through the mock
// plugin below; it exists only in the dev server, never in a production build.
import react from '@vitejs/plugin-react';
import type { Plugin } from 'vite';
import { defineConfig } from 'vitest/config';
import type { createMockApi as CreateMockApi, MockReply } from './src/test-support/mock-api/router';

/** The parts of Node's request the mock reads (the repo has no Node type package). */
interface MockHttpRequest {
  url?: string;
  method?: string;
  on: (event: 'data' | 'end' | 'close', listener: (chunk?: unknown) => void) => void;
}

/** The parts of Node's response the mock writes. */
interface MockHttpResponse {
  statusCode: number;
  setHeader: (name: string, value: string) => void;
  write: (chunk: string) => void;
  end: (chunk?: string) => void;
}

function readBody(req: MockHttpRequest): Promise<unknown> {
  return new Promise((resolve) => {
    let text = '';
    req.on('data', (chunk) => {
      text += String(chunk);
    });
    req.on('end', () => {
      try {
        resolve(text === '' ? null : (JSON.parse(text) as unknown));
      } catch {
        resolve(null); // Recovers: a non-JSON body reads as empty; the route validates.
      }
    });
  });
}

function sendSse(req: MockHttpRequest, res: MockHttpResponse, reply: Extract<MockReply, { kind: 'sse' }>) {
  res.statusCode = 200;
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.write(': mock stream\n\n');
  const timers: ReturnType<typeof setTimeout>[] = [];
  const play = (offsetMs: number) => {
    for (const event of reply.events) {
      timers.push(setTimeout(() => {
        res.write(`data: ${JSON.stringify(event.data)}\n\n`);
      }, offsetMs + event.delayMs));
    }
    if (reply.loopMs !== null) {
      const loopMs = reply.loopMs;
      timers.push(setTimeout(() => {
        play(0);
      }, offsetMs + loopMs));
    }
  };
  play(0);
  req.on('close', () => {
    for (const timer of timers) clearTimeout(timer);
  });
}

function send(req: MockHttpRequest, res: MockHttpResponse, reply: MockReply) {
  if (reply.kind === 'sse') {
    sendSse(req, res, reply);
    return;
  }
  if (reply.kind === 'empty') {
    res.statusCode = reply.status;
    res.end();
    return;
  }
  setTimeout(() => {
    res.statusCode = reply.status;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify(reply.body));
  }, reply.delayMs);
}

/** Dev-only plugin: /api/* from fixtures, PUT /mock-s3/* as a fake S3 part upload. */
function mockApi(): Plugin {
  return {
    name: 'nimbytes-mock-api',
    apply: 'serve',
    async configureServer(server) {
      // Loaded through Vite (not imported by this config) so the router gets the app's aliases.
      const router = (await server.ssrLoadModule('/src/test-support/mock-api/router.ts')) as {
        createMockApi: typeof CreateMockApi;
      };
      const api = router.createMockApi(() => Date.now());
      server.middlewares.use((rawReq, rawRes, next) => {
        const req = rawReq as unknown as MockHttpRequest;
        const res = rawRes as unknown as MockHttpResponse;
        const url = new URL(req.url ?? '/', 'http://mock.local');
        const method = req.method ?? 'GET';
        if (url.pathname.startsWith('/mock-s3/') && method === 'PUT') {
          void readBody(req).then(() => {
            res.statusCode = 200;
            res.setHeader('ETag', `"mock-${url.pathname.split('/').join('-')}"`);
            res.end();
          });
          return;
        }
        if (!url.pathname.startsWith('/api/')) {
          next();
          return;
        }
        void readBody(req).then((body) => {
          const path = url.pathname.slice('/api'.length);
          send(req, res, api.handle({ method, path, query: url.searchParams, body }));
        });
      });
    },
  };
}

export default defineConfig(({ mode }) => ({
  plugins: mode === 'mock' ? [react(), mockApi()] : [react()],
  resolve: {
    // The Remotion composition has one home, render/src/composition; the Player imports it here.
    alias: {
      '@nimbytes/composition': decodeURIComponent(
        new URL('../render/src/composition/index.ts', import.meta.url).pathname,
      ),
    },
    // render/ has its own node_modules; React and Remotion must be the app's single copies.
    dedupe: ['react', 'react-dom', 'remotion'],
  },
  server: {
    proxy:
      mode === 'mock' ? {} : { '/api': { target: 'http://localhost:8080', changeOrigin: false } },
  },
  test: {
    environment: 'jsdom',
    include: ['src/**/*.test.{ts,tsx}'],
    // tokens.test.ts reads tokens.css?raw; Vitest blanks CSS it does not process.
    css: { include: [/tokens\.css/] },
  },
}));
