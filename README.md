# nimbytes

Intelligent storage for Ray-Ban Meta glasses footage. Upload POV clips from your phone; Meta models
understand every moment; search your library down to the second; let an AI editor cut, watch and
revise a post-ready short.

> *Your glasses capture everything, your phone can't keep it all. We store it, understand it, and
> turn any moment into a post.*

Built for the Meta Global AI Developer Hackathon (Oct 26 – Nov 4, 2026). Work in progress — the
full README (architecture, Meta models used, setup, what was built during the event) lands before
submission.

## Planned stack

| Layer | Choice |
| --- | --- |
| App | Mobile-first installable PWA (Vite + React + TypeScript, vanilla CSS) |
| API | Rust (Axum + Tokio), SQLite + sqlite-vec, Tantivy, ffmpeg |
| Storage | Amazon S3 (presigned multipart upload, Intelligent-Tiering) |
| AI | Meta Muse Spark 1.3, SAM 3.1, Muse Voice Transcribe, Perception Encoder (local ONNX) |
| Infra | Terraform, Docker Compose, Caddy |
