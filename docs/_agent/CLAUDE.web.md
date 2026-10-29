# web/ — PWA

Rules: `/CLAUDE.md` (hard rules + dk-coding lite). Web layer rules:
`~/Projects/.claude/rules/stack/web-react.md`, as trimmed by `/CLAUDE.md`. Endpoints and types:
`docs/contracts.md`.

## Layout

```
src/
  app/        composition root: env (import.meta.env, parsed once), providers, router
  design/     tokens.css (the only colour/space/radius source) + primitives (Button, Card, Chip, Sheet)
  services/   api/ (client.ts — the only fetch caller; types.ts — mirror of api contracts), upload/ (multipart)
  hooks/      useClips, useClip, useSearch, useUpload, useShort, useEvents (SSE)
  pages/      Upload, Library, ClipDetail, Search, Editor
  components/ feature components used by pages
```

## Package rules

- Mobile-first: design at 390 px wide, test on the owner's iPhone. Touch targets ≥ 44 px.
- Components never call `fetch`, `EventSource` or S3; they use hooks, hooks use services.
- Env only through `import.meta.env.VITE_*`, read in `app/env.ts`.
- Browser storage (IndexedDB / localStorage) only for upload resume and small UI prefs, always in
  try/catch.
- Service worker caches the app shell only; never caches API responses or media.

## Gates

```bash
npm run lint
npm test           # vitest run, offline, < 20 s
npm run build      # tsc --noEmit + vite build
```

What to test and what never to test: `/CLAUDE.md` "Testing". Tests sit beside the file
(`foo.ts` → `foo.test.ts`). Hooks are tested with a mocked service module; components only where
they hold logic (Testing Library, jsdom). No Playwright / browser automation.
