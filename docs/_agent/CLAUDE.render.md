# render/ — Remotion composition + renderer service

Rules: `/CLAUDE.md` (hard rules + dk-coding lite + Testing). Plan: `docs/phases/06-timeline-render.md`.
Before writing Remotion code, load the `remotion:remotion-best-practices` skill (and
`remotion:remotion-captions`, `remotion:remotion-render` as needed).

## Layout

```
src/composition/   NimbytesShort + props type + Zod schema — the ONE source the PWA Player imports
src/server.ts      POST /render {props, out_url} → renderMedia → PUT to presigned S3 URL
src/frames.ts      pure frame maths (clip starts, total frames, caption windows)
fixtures/          props.sample.json — shared with the Rust props-builder test
Dockerfile         node:22-bookworm-slim arm64 + Chrome Headless Shell deps
```

## Package rules

- The props wire shape is owned by Rust (`api/crates/contracts`); the Zod schema here validates it
  and both sides test against `fixtures/props.sample.json`.
- Styling inside the composition uses the PWA design tokens (same font, accent); no Tailwind.
- The server holds no state, renders one job at a time and never reads env except in its entry file.

## Gates

```bash
npm run lint
npm test        # vitest, offline, no real renders
npm run build   # tsc --noEmit
```
