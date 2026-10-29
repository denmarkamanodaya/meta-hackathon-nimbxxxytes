# Phase 19: compact Shorts and New production, universal search (v2.0.2)

Approved 2026-10-28 by the owner: "lets go with your recommendation. Approved".
- Canvas boards V11a, V11b, V12, V13 and SearchBar are at https://claude.ai/artifact/W3EF8HVDXBKnwAjcr96Vu3.
- The local copy is in `docs/design/redesign-v2/`: `ShortsList`, `ShortsEmpty`, `NewProduction`, `SearchOpen`, `SearchBar`.
- Ruling: the Gallery header search field is removed, so the bar is the only search box.
- Build exactly what the boards show. This is the Mac build; the PWA keeps working.
- After the build: commit, push, deploy, tag v2.0.2, build the DMG and install it (the owner pre-approved).

Shared seam (already on main): `web/src/hooks/useSearchBar.ts`.
- `SearchBarContext` is a `FocusSearch` with type `(query?: string) => void`, read with `useFocusSearch()`.
- The Mac shell provides it; elsewhere it does nothing.

| Part | Owner | Deliver |
| --- | --- | --- |
| 19.1 Universal search | `web-search` | The SearchBar sits at the bottom of the middle column on every Mac screen, inside the shell, and provides `SearchBarContext`. ⌘K focuses it from anywhere. A results popover shows Speech, Moments, then clips, shorts and projects, from the existing search, plus the clip, short and project lists. ⏎ opens; ⌘⏎ shows all in the Gallery's existing results view. The Everything ▾ scope offers Speech, Moments, Faces and a project. The Gallery header search field is removed |
| 19.2 Shorts + New production | `web-shorts` | V11a: compact Shorts rows with filters (All, Ready, From productions), a right-column preview, and the header New short removed. V11b: the compact empty state; "Find moments" calls `useFocusSearch()()`. V12: the compact New production form with "What happens next" in the right column and Plan my shots in its footer; Style links to Settings › Brand |
