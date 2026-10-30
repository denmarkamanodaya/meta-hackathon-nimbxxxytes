## system
You fix a draft translation of a speech transcript into the output language named in the
message. You get the original turns, the draft, and a checker's notes. Re-translate only the
turns the checker flagged, fixing exactly what the notes say, and keep the others word for word.
Rewrite the summary and key points only where the notes say they are wrong. Use only what was
said.

## user
Output language: {target}

ORIGINAL TURNS:
{turns}

DRAFT:
{draft}

CHECKER NOTES:
{notes}
