# Phase 8 — Deploy, demo library, demo video

**Day:** Tue 3 Nov · **Depends on:** Phase 7 (or the cut-down version of it)

## Goal

The app runs on a public HTTPS URL judges can open, with a seeded demo library that never waits on
the API, and the 3-minute demo video is recorded and cut.

## Tasks

| # | Task | Owner | Notes |
| --- | --- | --- | --- |
| 8.1 | Terraform `app` stack: EC2 `t4g.large` (Amazon Linux 2023 arm64; ~$2.30/day running, ~$0.28/day stopped; stop it between sessions), 30 GB gp3 data volume, Elastic IP, security group (80/443 any, 22 owner IP), instance profile with the storage policy; user-data installs Docker + compose. `terraform plan` shown, **apply only after owner yes** | ml-infra | `infra/stacks/app/` |
| 8.2 | `scripts/deploy.sh` (api **and renderer** images): `docker buildx build --platform linux/arm64` on the Mac → `docker save | gzip | ssh ec2-user@<eip> 'gunzip | docker load'` → copy compose + Caddyfile + `.env` (scp, never committed) → `docker compose up -d` | lead | No ECR |
| 8.3 | Caddy site `<eip-dashed>.sslip.io`, automatic Let's Encrypt; `PUBLIC_BASE_URL` set to it; S3 CORS updated with the origin (Terraform variable) | ml-infra | |
| 8.4 | Demo library: ingest the owner's 5–10 clips on the box; export `model_cache` so a re-seed is free | lead | |
| 8.5 | Harden the happy path: error toasts with codes, empty states, loading skeletons on the five screens, iOS install prompt hint | web | |
| 8.6 | `GET /api/costs` + small "cost so far" line in settings (shows judges the system is cheap) | api + web | |
| 8.7 | Record the demo video per `docs/demo-video.md`: screen recording on the iPhone + glasses POV b-roll; edit to ≤ 3:00 | owner + lead | Use nimbytes itself to cut one of the b-roll shorts |

## Unit tests

| Test | Covers |
| --- | --- |
| `GET /api/costs` aggregation by model from a seeded temp DB | 8.6 |
| `scripts/deploy.sh` has a `--dry-run` that prints every command; run it once before the real deploy | 8.2 |

The deployed full loop is checked by hand (owner), never by an automated end-to-end suite.

## Acceptance checks

- [ ] `https://<eip-dashed>.sslip.io` opens on a phone that has never seen the app; install to home
      screen works.
- [ ] Full loop on the deployed box: upload → ready → search → name → agent short → download.
- [ ] Box reboot: data survives (EBS), app comes back with `restart: unless-stopped`.
- [ ] Demo video exported, ≤ 3:00, captions on.
- [ ] Terraform state and the destroy command written in `STATUS.md` for after the event.

## Cost ruling (owner, 2026-10-27)

- c7g.xlarge (~$4.80/day) rejected as too costly. Box is **t4g.large** (same 8 GB RAM, 2 vCPU,
  burstable; renders about 2x slower: final ~40 s). Set `RENDER_CONCURRENCY=2` on the box.
- Until Mon 2 / Tue 3 Nov there is **no box**: the phone reaches the Mac's local compose stack
  through a Cloudflare quick tunnel (`cloudflared tunnel --url https://localhost:443 --no-tls-verify
  --http-host-header localhost --origin-server-name localhost`). The URL changes on every restart.
  S3 CORS allows `https://*.trycloudflare.com` for this (applied 2026-10-27).
- Stop the box whenever it is not needed for testing or judging.
