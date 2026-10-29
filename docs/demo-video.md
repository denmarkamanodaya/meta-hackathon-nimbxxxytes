# Demo video script (≤ 3:00)

The video is one of the main scoring items (`docs/hackathon-rules.md`). Lead with what no basic RAG
app or image analyzer does: an agent that edits, watches its own cut and fixes it.

| Time | Shot | Voice-over (draft) |
| --- | --- | --- |
| 0:00–0:15 | Glasses POV b-roll, quick cuts; phone storage-full warning | "My glasses capture everything. My phone can't keep it all, and I never edit any of it." |
| 0:15–0:25 | Title card: nimbytes + pitch line | "nimbytes stores it, understands it, and turns any moment into a post." |
| 0:25–1:20 | **Editor:** type "15-second reel of my morning, start with the coffee" → live agent steps → v1 preview → critique notes appear with timestamps ("2.4 s: second shot repeats the angle") → v2 → scores rise → final 4:5 with captions plays | "Other editors generate a cut and leave the fixing to you. Here Muse Spark plans the cut, renders a preview, watches it, critiques its own work — hook, pacing, continuity — and revises. Every step shows its reasoning: why this shot, what was wrong, what changed." |
| 1:20–1:55 | **Search:** "when Sam laughed at the beach" → results with reasons → tap → player jumps to the exact second | "Every clip is understood: scenes by Muse Spark, speech and speakers by Muse Voice Transcribe, visuals by Perception Encoder. Search lands on the second." |
| 1:55–2:20 | **People:** clip detail → face crops from SAM 3.1 → name "Sam" → hide a bystander | "SAM 3.1 finds the people and pets in each clip. Turn on matching and Perception Encoder plus Muse Spark suggest 'Is this Leo?' across clips — nothing is named until I say yes. Bystanders I hide." (privacy line: `docs/hackathon-rules.md` "Privacy stance") |
| 2:20–2:40 | **Upload:** pick 5 clips from the gallery, multipart progress, statuses flip to ready; then scroll the library and replay a clip instantly | "Upload straight from the gallery to private, encrypted storage that tiers itself to save cost. It lives in the cloud but browses like it's on your phone: light proxies, cached on the device, and every AI answer cached so a repeat costs nothing." (claims and limits: `docs/positioning.md` "Smart storage and caching") |
| 2:40–3:00 | Architecture slide (models → steps) + cost per clip-minute + repo URL | "Four Meta models, one Rust backend, built this week. Cost: ‹X› cents per minute of footage." |

## Recording notes

- Record on the iPhone (screen recording) against the deployed box, demo library pre-seeded and
  cached, so nothing waits on the network.
- People on camera: only those who agreed. No copyrighted music.
- Keep a backup recording of the Phase 6 full loop in case Phase 7 is cut.

Mac segment (optional, if time allows): pitch points and the "On this Mac" before/after beat are in
`docs/positioning.md` "nimbytes for Mac: zero bytes on disk and the smart cache".
