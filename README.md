# nimbytes

Intelligent storage for Ray-Ban Meta glasses footage. Upload POV clips from your phone; Meta models
understand every moment; search your library down to the second; let an AI editor cut, watch and
revise a post-ready short.

> *Your glasses capture everything, your phone can't keep it all. We store it, understand it, and
> turn any moment into a post.*

Built for the Meta Global AI Developer Hackathon (Oct 26 – Nov 4, 2026). The full write-up
(architecture, setup, what was built during the event) lands before submission.

## What it does (v1.0.0)

| Feature | How |
| --- | --- |
| Upload | Straight from the phone to private S3 with resumable multipart upload; exact duplicates are spotted before upload and again by content hash, so a copy never costs a model call |
| Understand | Each clip is split into moments, described, titled and transcribed with speakers; faces of people and pets are found per clip |
| Search | Natural-language search lands on the second: keyword and image-vector search fused, then reranked with reasons; repeat searches come from cache at no cost |
| People & pets | Name a face once and it becomes searchable; hide bystanders. Opt-in matching suggests the same face across your own clips, and nothing is named until you confirm |
| Agentic editor | Plans a short from your moments, renders a preview, watches it, critiques it (hook, pacing, flow, captions, length) and revises, showing what changed and why |
| Storage that pays for itself | Lives in the cloud and browses like it's on your phone: clips stream as light 720p copies, thumbnails replay from the phone's cache, AI answers are cached, and originals move to cheaper storage on their own |

## Meta models

| Model | Used for |
| --- | --- |
| Muse Spark 1.3 | Moment descriptions, clip titles, query rewrite and rerank, edit planning, watching and critiquing drafts, confirming face matches |
| SAM 3.1 | Finding and tracking faces of people and pets in each clip |
| Muse Voice Transcribe | Transcripts with speaker turns, used for search and phrase captions |
| Perception Encoder (PE-Core-B16-224, local ONNX) | Image and text vectors for search; look-alike face proposals when matching is on |

## Stack

| Layer | Choice |
| --- | --- |
| App | Mobile-first installable PWA (Vite + React + TypeScript, vanilla CSS) |
| API | Rust (Axum + Tokio), SQLite + sqlite-vec, Tantivy, ffmpeg |
| Rendering | Remotion composition, shared by the in-app preview player and the server renderer |
| Storage | Amazon S3 in Sydney (presigned multipart upload, Intelligent-Tiering) |
| Infra | Terraform, Docker Compose, Caddy |

## nimbytes for Mac

A signed Mac app that turns your library into a real `~/nimbytes` folder for Final Cut Pro, DaVinci
Resolve or Premiere, and runs the full nimbytes app in its window with media played from disk.

```
~/nimbytes/
  Library/     720p proxies of every ready clip, synced within about 30 s
  Originals/   full-quality originals: "Make available offline", or fetched for an edit
  Projects/    FCPXML of AI-made shorts, media already linked
  Shorts/      final rendered shorts
  Exports/     drop a finished edit here; it uploads and appears in your library
```

- **Install:** download the DMG from Releases and drag nimbytes to Applications. The app is signed
  but not notarized, so the first time, right-click it and choose Open.
- **Sign in** with the passcode. The session stays in the macOS Keychain.
- **Editors:** "Open in Final Cut Pro" writes the AI's cut as FCPXML 1.10, frame-accurate, with a
  marker on every shot giving the AI's reason. The same file imports in DaVinci Resolve. Clips you
  made available offline link to the originals; the rest link to the 720p proxies. Captions,
  punch-in and transitions are left for you to finish in the editor.
- Clips deleted in nimbytes go to the macOS Trash, never a hard delete.

Build steps are in `desktop/README.md`.

## Privacy

Media sits in a private, encrypted bucket and is reached only through short-lived signed links after
an ownership check. Faces are detected per clip. Matching across clips is opt-in, stays in your
library and only suggests; turning it off deletes the face data.
