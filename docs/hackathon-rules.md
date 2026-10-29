# Hackathon rules and how we comply

Source: the rules text the owner shared on 2026-10-27 (Meta Global AI Developer Hackathon).
Breaking these can disqualify the project.

| Rule | What it means for us | How we comply |
| --- | --- | --- |
| **New work only** — everything presented is built during the event, **Oct 26 – Nov 4** | No code, assets or docs from earlier work | Fresh repo created 2026-10-27; `CLAUDE.md` hard rule 2; small dated commits on `main` |
| **Identify your contributions** — the demo shows only what the team built during the event; judges must be able to tell what is new | Third-party pieces must be clearly labelled as third-party | README section "Built during the event" lists every feature with its first commit; README "Third-party" lists Meta models, PE weights, ffmpeg, Remotion, crates/npm packages |
| **Public repo** | Repo must be public at submission | GitHub `denmarkamanodaya/meta-hackathon-nimbxxxytes`, public; no secrets ever committed (`CLAUDE.md` hard rule 6) |
| **Teams** — max 4, solo allowed; one track only; one person submits | | Solo, **Indie Developer** track (confirm in Phase 9) |
| **Demo video** — 3 minutes, required, one of the main scoring items | Plan time for it; it is not an afterthought | Script in `docs/demo-video.md`; recorded in Phase 8 (Tue Nov 3), not on the last day |
| **Banned** — legal/ethical/platform-policy breaches; code, data or assets without rights | Every asset we show must be ours or licensed for this use; faces of people who did not agree are blurred | The owner's own footage for the creator story and the Ready walkthrough. **Phase 23 Respond/Recover uses licensed sample footage** (owner ruling 2026-10-28): DVIDS (public domain, US government work) and Pexels (Pexels License). Faces and plates blurred; no copyrighted music (938842's audio removed); PE weights Apache-2.0 with `ml/NOTICE` |
| **Banned: generic projects** — basic RAG apps, simple image analyzers, AI-for-education chatbots, health/nutrition, job screeners, personality analyzers, sports coaches | Library search alone could read as "basic RAG"; clip descriptions alone could read as "simple image analyzer" | The demo leads with the **agentic editor** (plan → render → critique → revise) and treats search and people tags as what powers it. See `docs/demo-video.md` |
| **Theme** — "Build for Your World" (Meta models in a domain you know, solving a real problem) or "Push the Frontier" | | **Build for Your World**: POV creators whose glasses capture more than their phone can keep or edit |

## Privacy stance (say it in the README and the video)

- Faces (people and pets) are **detected per clip**. Matching across clips is **opt-in** (Settings,
  off by default), stays inside the owner's own library, and only **suggests**: Perception Encoder
  proposes look-alike crops and Muse Spark confirms each pair; nothing is named until the owner
  taps Yes. Turning it off deletes every face vector. (Owner ruling 2026-10-27, replacing "no face
  embeddings, no matching across clips".)
- Bystanders can be hidden with one tap; hidden tracks are excluded from search and from renders'
  "people" metadata.
- All media is in a private S3 bucket, encrypted at rest, reachable only through short-lived
  presigned URLs after an ownership check.

## Licensed sample footage (Phase 23, owner ruling 2026-10-28)

The owner lives alone and cannot stage a multi-person disaster response, so Respond and Recover are demonstrated on licensed sample clips. This is allowed: the rule bans assets **without rights**, and these clips come with rights. They are input data, not work we claim to have made.

| Source | Licence | Conditions we follow |
| --- | --- | --- |
| DVIDS | Public domain (US government work; https://www.dvidshub.net/about/copyright) | No implied endorsement: show "The appearance of U.S. Department of War (DoW) visual information does not imply or constitute DoW endorsement." when its footage appears. People keep their privacy rights: faces blurred. Third-party material inside an item (for example music) is removed |
| Pexels | Pexels License (https://www.pexels.com/license/) | Never show identifiable people in a bad light; never sell clips as they are; no implied endorsement |

How we comply:
1. Every clip is listed with its page and licence in `data/samples/SOURCES.csv` (git-ignored; the clips are never committed). The README "Third-party" section lists them.
2. In the demo video, an on-screen credit runs whenever sample footage plays: "Sample footage: DVIDS (public domain) · Pexels. No endorsement implied."
3. Faces and number plates are blurred in everything shown.
4. The owner's own footage still carries the creator story and the Ready walkthrough, so judges see nimbytes on our own footage too.
5. The video says it plainly: "Respond is shown on public disaster footage, because we can't stage a hurricane."
6. **Open check for the owner:** read the official rules or FAQ for any clause on third-party media before recording. If one is stricter, Respond falls back to a short segment on public footage.
