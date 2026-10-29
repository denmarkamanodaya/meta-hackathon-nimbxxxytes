# Phase 7 — Agentic editor (plan → preview → critique → revise)

**Days:** Sun 1 Nov (tools + one critique pass) · Mon 2 Nov (revise loop, guardrails, trail UI)
**Depends on:** Phase 6

## Goal

Replace the single planning call with an agent that plans, renders a low-res preview, watches it,
critiques it with timestamped notes, and revises up to twice before showing the user the best
version and the full critique trail (v1 → v2 → v3), **with the reasoning shown at every step**: why each
shot was chosen, what the critique found, and what each revision changed and why. This is the
feature the demo video leads with, and the main thing that sets nimbytes apart from editors that
only generate a cut for light manual adjustment (`docs/positioning.md`).

## Tasks — Sun 1 Nov

| # | Task | Owner | Notes |
| --- | --- | --- | --- |
| 7.1 | Tool definitions (JSON schema) for `search_moments`, `get_segment`, `render_preview`, `critique_preview` | lead | `api/prompts/agent_tools.json` |
| 7.2 | `core::usecases::edit_agent`: loop over Spark tool calls; dispatch tools to ports; append tool results; budget counters (tool calls ≤ 12, revisions ≤ 2, wall clock ≤ 150 s, cost ≤ $0.25 per short) | api | Pure loop over ports; `Clock` injected |
| 7.3 | `render_preview` tool → Remotion preview render via the `Renderer` port (Phase 6.6) → `previews/{short}/v{n}.mp4` | api | Spark watches this MP4; the human sees the Player |
| 7.4 | `critique_preview` tool → Spark with the preview as `input_video` + the timeline + the user prompt → critique JSON (`docs/contracts.md`), schema-validated | api | Rubric prompt `api/prompts/critique.md` |
| 7.5 | Persist every step to `agent_steps`; stream via `GET /api/shorts/{id}/events` | api | |

## Tasks — Mon 2 Nov

| # | Task | Owner | Notes |
| --- | --- | --- | --- |
| 7.6 | Revise: feed critique notes back; agent returns a new timeline **with `revision.changes[]`, each change citing the critique note it answers** (`docs/contracts.md`); re-render; re-critique; keep best `score_total`; stop on `verdict = accept` or budget | api | Reject a v2+ timeline without `revision` (retry once) |
| 7.7 | Guardrails: reject timelines referencing segments not in the candidate set or other users' segments; timeline clamp from 6.2; on any budget hit, finish with best version so far | api | |
| 7.8 | Critique trail UI ("reasoning shown"): stepper v1 → v2 → v3; each version shows the agent's `rationale`, preview (Remotion Player from `composition_props`; the agent's MP4 as fallback), five score bars, timestamped critique notes (tap seeks the preview), and each `revision.changes[]` entry as "what changed → why", linked to the note it answers; per-clip "why this shot" on the timeline cards | web | Centrepiece of the demo |
| 7.9 | Live agent progress: step list animating from SSE ("Planning…", "Rendering v1…", "Watching v1…", "Revising…") | web | |
| 7.10 | Stretch (only if all of the above is done by Mon 2 Nov 15:00): `track_subject` via SAM box prompt → punch-in crop box per clip | api | First item on the cut list |

## Unit tests

All with a scripted fake `Reasoner` (returns a fixed sequence of tool calls / critiques) — no model calls.

| Test | Covers |
| --- | --- |
| Happy path: plan → preview → critique (revise) → revise → critique (accept) → best version = highest `score_total` | 7.2, 7.6 |
| Budgets: tool-call cap, revision cap, wall clock (fake `Clock`), cost cap — each stops with the best version so far | 7.2, 7.7 |
| Guardrail: timeline with a segment outside the candidate set / of another user → rejected, step logged, loop continues | 7.7 |
| Tool dispatch: unknown tool name or invalid args → tool error returned to the model, not a crash | 7.2 |
| Critique JSON validation; `verdict` other than accept/revise rejected | 7.4 |
| v2+ timeline without `revision`, or a change citing no critique note → rejected and retried once | 7.6 reasoning guard |
| Every step persisted to `agent_steps` in order (`seq` strictly increasing) | 7.5 |
| Web: critique-trail diff (added / removed / retimed clips between versions) | 7.8 |

## Acceptance checks

- [ ] Every version in the trail shows its rationale; every v2+ change shows what changed and why.
- [ ] One prompt ("15-second reel of my morning, start with the coffee") produces ≥ 2 versions with a
      visible, sensible critique trail and the best version selected.
- [ ] Budget stop works: with revisions forced to fail, the user still gets v1.
- [ ] Agent cost per short recorded in `LEARNING.md`.
- [ ] Gates pass.

## Cut order (if behind)

1. `track_subject` / punch-in. 2. Second revision (keep one critique pass). Never cut the critique
trail UI — it is the demo's centrepiece.
