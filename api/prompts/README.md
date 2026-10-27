# api/prompts

Prompt templates and the JSON Schemas that the Muse Spark calls must satisfy. The API loads these
files at startup; nothing else in the repo holds prompt text.

## Template format

Each `.md` file has exactly two sections, in this order:

```
## system
...system prompt...

## user
...user message template...
```

- The text under `## system` is sent unchanged as the system message. Keep it stable, so the
  prompt-cache rate applies to it.
- The text under `## user` is the user message. Placeholders are `{name}`, which the API replaces
  before sending. The templates contain no other braces.
- Media (the segment video) is sent as a separate content part after the user text.

## Schemas

Each `*.schema.json` is sent as the structured-output schema (`text.format` with `type: json_schema`,
`strict: true`) and checked again by the API after the response arrives. Strict mode requires every
object to set `additionalProperties: false` and to list every property in `required`, so optional
values are nullable (`"type": ["string", "null"]`) instead of absent.

| Prompt | Schema | Placeholders |
| --- | --- | --- |
| `segment_facts.md` | `segment_facts.schema.json` | `{start}` `{end}` `{recorded_at}` `{transcript}` |
| `query_rewrite.md` | `query_rewrite.schema.json` | `{today}` `{people}` `{speakers}` `{query}` |
| `rerank.md` | `rerank.schema.json` | `{query}` `{candidates}` |
| `plan_edit.md` | `timeline.schema.json` | `{target_seconds}` `{aspect}` `{request}` `{segments}` `{previous}` |
| `critique.md` | `critique.schema.json` | `{version}` `{target_seconds}` `{request}` `{timeline}` `{segments}` |
| `shot_list.md` | `shot_list.schema.json` | `{brief}` `{format}` `{target_seconds}` `{aspect}` `{library}` |
| `coverage_match.md` | `coverage_match.schema.json` | `{brief}` `{shots}` |
| `storyboard.md` | (image prompt, no schema) | `{act}` `{title}` `{direction}` |
| `story_brief.md` | (text, no schema) | `{brief}` `{shots}` |

`rerank.schema.json` leaves `segment_id` open; at call time the API sets
`results.items.properties.segment_id.enum` to the candidate ids, so the model can only return ids it
was given.

`segment_facts` deliberately leaves out `segment_id`, `start` and `end`: the API already knows them
and attaches them itself, so the model can never invent or alter them.

`coverage_match` judges every shot of a production in one call. Its `segment_id` stays open (null
means "not covered"); the API keeps a verdict only when the id is one of that shot's own
candidates and no earlier shot already took it.

`storyboard.md` is the Muse Image prompt for a storyboard frame: the system text (the drawing
style) and the filled user text are joined with a blank line into one prompt.

`story_brief.md` is not a model call of its own: its filled user text becomes the request of the
story short, which the existing editor plans unchanged. Its system section is not sent.
