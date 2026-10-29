# Phase 9 — README and submission

**Day:** Wed 4 Nov (submit early; deadline time to confirm on the submission page — `STATUS.md` Q4)

## Goal

A README that lets judges understand, verify and run the project, and a complete submission in the
Indie Developer track.

## Tasks

| # | Task | Owner |
| --- | --- | --- |
| 9.1 | README: problem, demo link + video link, screenshots, architecture diagram (from `docs/architecture.md`), **Meta models used and exactly where** (table: model → pipeline step → file), setup (`.env.example`, `make models`, `docker compose up`), cost per clip-minute and per short from `LEARNING.md` | lead |
| 9.1b | README "What's different": the table from `docs/positioning.md` (only rows that are built) | lead |
| 9.2 | README "Built during the event (Oct 26 – Nov 4)": every feature with its first commit hash; statement that no prior code was used | lead |
| 9.3 | README "Third-party": Meta Model API, PE-Core weights (Apache-2.0, `ml/NOTICE`), ffmpeg, **Remotion** (licence tier recorded), Rust crates, npm packages, caption font (OFL) | lead |
| 9.4 | README "Privacy": detection-only faces, hide bystanders, private bucket (text in `docs/hackathon-rules.md`) | lead |
| 9.5 | Licence check: `cargo deny check licenses` once; `npx license-checker --summary` once | api + web |
| 9.6 | Final secret scan: `git log -p | grep -iE "MODEL_API_KEY=|AKIA|secret"` returns nothing; repo public | lead |
| 9.7 | Remove debug endpoints and spike binaries; full gates incl. `cargo test` + `npm test` green on the final commit | api |
| 9.7b | README "Quality": how to run the unit tests, what they cover, and that end-to-end checks were manual | lead |
| 9.8 | Submit: track **Indie Developer**, theme **Build for Your World**, repo URL, video, live URL | owner |

## Acceptance checks

- [ ] A fresh clone + `.env` + `make models` + `docker compose up` runs locally (owner checks).
- [ ] README renders on GitHub with working links.
- [ ] Submission confirmation received.

## After the event (not part of the build)

- `terraform destroy` for `app` then `storage` stacks — owner yes required for each.
