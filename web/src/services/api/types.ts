// Wire types for the nimbytes API: the one TypeScript mirror of api/crates/contracts.
// Any change to a wire shape edits both in the same commit.
import errorCodes from './error-codes.json';

declare const errorCodeBrand: unique symbol;

/**
 * One of the API's `UPPER_SNAKE` error codes. The list lives only in `error-codes.json`, which
 * the api crate tests its `ErrorCode` enum against; the brand means a value can only come from
 * `isErrorCode`, never from a hand-typed literal.
 */
export type ErrorCode = string & { readonly [errorCodeBrand]: true };

/**
 * Narrows a value to a known API error code.
 * @param value - Anything, usually `error.code` from a response body.
 * @returns True when `value` is listed in `error-codes.json`.
 */
export const isErrorCode = (value: unknown): value is ErrorCode =>
  typeof value === 'string' && errorCodes.includes(value);

/** Error envelope every non-2xx API response carries. */
export interface ErrorBody {
  error: { code: string; message: string };
}

/** `GET /api/health` response. */
export interface Health {
  ok: boolean;
}

/** `POST /api/session` response; the session itself travels in the `nb_session` cookie. */
export interface SessionResponse {
  user_id: string;
}

/** Lifecycle of a clip, from first byte to fully understood. */
/** `duplicate` is final: the server found the same file already in the library and stopped. */
export type ClipStatus = 'uploading' | 'uploaded' | 'processing' | 'ready' | 'failed' | 'duplicate';

/** A presigned S3 `UploadPart` URL for part `n` (1-based). */
export interface PresignedPart {
  n: number;
  url: string;
}

/** `POST /api/uploads` request. */
export interface CreateUploadRequest {
  filename: string;
  size_bytes: number;
  content_type: string;
}

/** `POST /api/uploads` response; `part_size` is in bytes, `parts` covers every part. */
export interface CreateUploadResponse {
  upload_id: string;
  clip_id: string;
  part_size: number;
  parts: PresignedPart[];
}

/** `POST /api/uploads/{id}/parts` request (re-presign for resume). */
export interface PresignPartsRequest {
  part_numbers: number[];
}

/** `POST /api/uploads/{id}/parts` response. */
export interface PresignPartsResponse {
  parts: PresignedPart[];
}

/** A finished part: its number and the `ETag` header S3 returned for it. */
export interface CompletedPart {
  n: number;
  etag: string;
}

/** `POST /api/uploads/{id}/complete` request; parts in ascending `n`. */
export interface CompleteUploadRequest {
  parts: CompletedPart[];
}

/** `POST /api/uploads/{id}/complete` response. */
export interface CompleteUploadResponse {
  clip_id: string;
  status: 'uploaded';
}

/** One row of `GET /api/clips`. Fields unknown until processing are null. */
export interface ClipSummary {
  clip_id: string;
  /** Short human title the describe step writes (falls back to the filename on the server). */
  title: string;
  filename: string;
  duration_s: number | null;
  recorded_at: string | null;
  status: ClipStatus;
  thumb_url: string | null;
  segment_count: number;
  people: string[];
  /** The clip this one is a byte-for-byte copy of (status `duplicate`), else null. */
  duplicate_of: string | null;
  /** The original's declared size, bytes. */
  size_bytes: number;
  /** Projects the clip is in; [] when none. */
  project_ids: string[];
  /** Transcript turns; 0 when nothing was said. */
  speech_count: number;
  /** Face tracks that are not hidden; 0 when none. */
  face_count: number;
}

/** `POST /api/uploads/check` body: matched on the same user, filename and size. */
export interface UploadCheckRequest {
  filename: string;
  size_bytes: number;
}

/** `POST /api/uploads/check` answer. */
export interface UploadCheck {
  duplicate_of: { clip_id: string; title: string } | null;
}

/** `GET /api/settings` and the body of `PUT /api/settings`. */
export interface Settings {
  /** Opt-in: compare faces across the user's own clips to suggest names. Off deletes face data. */
  face_matching: boolean;
  /** Blur phone and laptop screens and number plates in every new render (default false). */
  blur_objects: boolean;
}

/** A named person a face group probably is (only while face matching is on). */
export interface FaceSuggestion {
  person_id: string;
  name: string;
  /** Cosine similarity, 0–1. */
  similarity: number;
}

/** One 5–10 s window of a clip. Fact fields are null until the describe step has run. */
export interface Segment {
  segment_id: string;
  /** 0-based order within the clip. */
  idx: number;
  /** Seconds from clip start. */
  start_s: number;
  end_s: number;
  description: string | null;
  actions: string[];
  objects: string[];
  place: string | null;
  mood: string | null;
  /** 0–10. */
  quality: number | null;
  /** 0–10. */
  hook_score: number | null;
  thumb_url: string | null;
}

/** One transcript turn. `speaker_id` is null when diarization gave no speaker. */
export interface Turn {
  turn_id: string;
  start_s: number;
  end_s: number;
  text: string;
  speaker_id: string | null;
}

/** A speaker in one clip; `display_name` is null until the user names them. */
export interface Speaker {
  speaker_id: string;
  /** Raw diarization label from Voice Transcribe: a letter, `"A"`, `"B"`, …. */
  label: string;
  display_name: string | null;
}

/** A face track: one detected person across the clip. */
export interface Track {
  track_id: string;
  crop_url: string | null;
  first_s: number;
  last_s: number;
  person_name: string | null;
  hidden: boolean;
}

/** `GET /api/clips/{id}` response. `proxy_url` is null until the proxy is made. */
export interface ClipDetail {
  clip: ClipSummary;
  proxy_url: string | null;
  segments: Segment[];
  turns: Turn[];
  speakers: Speaker[];
  tracks: Track[];
}

/** Ingest pipeline steps, in run order. */
export const PIPELINE_STEPS = [
  'probe',
  'proxy',
  'derivatives',
  'segments',
  'transcribe',
  'describe',
  'title',
  'faces',
  'embed',
  'index',
  'ready',
] as const;

/** One ingest step. */
export type PipelineStep = (typeof PIPELINE_STEPS)[number];

/** State of one step. */
export type StepStatus = 'running' | 'done' | 'failed';

/** `GET /api/clips/{id}/events` SSE `data` payload (default `message` event). */
export interface ClipEvent {
  step: PipelineStep;
  status: StepStatus;
}

/** Structured filters the query rewrite extracted. Missing fields mean "no filter". */
export interface SearchFilters {
  people: string[];
  speakers: string[];
  place: string | null;
  /** ISO date or instant, inclusive. */
  from: string | null;
  to: string | null;
  /** 0–10. */
  min_quality: number | null;
}

/** How the server understood the query. */
export interface RewrittenQuery {
  keywords: string[];
  filters: SearchFilters;
}

/** One moment found by search: a segment and why it matched. */
export interface SearchResult {
  segment_id: string;
  clip_id: string;
  start_s: number;
  end_s: number;
  thumb_url: string | null;
  /** One line from the rerank; null when rerank did not run. */
  reason: string | null;
  score: number;
  clip_filename: string;
  /** The clip's human title. */
  clip_title: string;
  recorded_at: string | null;
  /** Named people on screen in this moment. */
  faces: SearchFace[];
}

/** A named face shown on a search result. */
export interface SearchFace {
  name: string;
  crop_url: string | null;
}

/** `POST /api/search` response. `reranked` is false when results are in fused order. */
export interface SearchResponse {
  rewritten: RewrittenQuery;
  results: SearchResult[];
  reranked: boolean;
  /** Server time for the whole search, ms. */
  took_ms: number;
  /** True when the answer came from the cache (no model calls). */
  cached: boolean;
  /** Model cost of this search in USD (0 when cached). */
  cost_usd: number;
}

/**
 * One stage of `POST /api/search/stream` (v1.1): SSE event `local` carries the fused BM25 + PE
 * order on the raw query (no model call, `reranked` false, reasons null); `ranked` carries what
 * `POST /api/search` answers. The stream then sends `done` and closes.
 */
export interface SearchStage {
  stage: 'local' | 'ranked';
  response: SearchResponse;
}

/** `GET /api/storage`: what the library holds and where. */
export interface StorageSummary {
  cloud_bytes: number;
  phone_bytes: number;
  /** Bytes of footage watched lately (kept in the contract; the app no longer shows it). */
  frequent_bytes: number;
  /** Bytes of the rest of the footage (kept in the contract; the app no longer shows it). */
  resting_bytes: number;
  clip_count: number;
  /** Everything stored for the account, bytes. */
  used_bytes: number;
  /** The account's storage cap, bytes. */
  cap_bytes: number;
  level: StorageLevel;
}

/** How full the account is: warn at 80 %, high at 95 %, full when no room is left. */
export type StorageLevel = 'ok' | 'warn' | 'high' | 'full';

/** A project's colour. */
export type ProjectColor = 'orange' | 'green' | 'blue' | 'purple' | 'pink' | 'grey';

/** Every project colour, in the order the New project sheet offers them. */
export const PROJECT_COLORS: readonly ProjectColor[] = ['orange', 'green', 'blue', 'purple', 'pink', 'grey'];

/** One row of `GET /api/projects`, and the answer of every project write. */
export interface Project {
  project_id: string;
  name: string;
  color: ProjectColor;
  clip_count: number;
  /** Sum of the known clip durations, seconds; 0 when none are known. */
  duration_s: number;
  /** Sum of the clips' original sizes, bytes. */
  size_bytes: number;
  /** ISO-8601 UTC. */
  created_at: string;
  /** Key art drawn from the project's best moments; null until drawn. */
  art_url: string | null;
  /** New art is being drawn. */
  art_drawing: boolean;
  /** The moments the key art was drawn from; [] before any art. */
  art_sources: ArtSource[];
}

/** One moment key art was drawn from. */
export interface ArtSource {
  clip_id: string;
  clip_title: string;
  /** The moment's own title. */
  title: string;
  /** Seconds from clip start. */
  start_s: number;
  thumb_url: string | null;
}

/** `POST /api/projects` body. */
export interface CreateProjectRequest {
  name: string;
  color: ProjectColor;
  clip_ids?: string[];
}

/** `PATCH /api/projects/{id}` body. */
export interface UpdateProjectRequest {
  name?: string;
  color?: ProjectColor;
}

/** `POST /api/projects/{id}/clips` body. */
export interface AddProjectClipsRequest {
  clip_ids: string[];
}

/** A named person in the people overview. */
export interface NamedPerson {
  person_id: string;
  name: string;
  clip_count: number;
  crop_url: string | null;
}

/** A face waiting for a name ("Who's this?"). */
export interface UnnamedFace {
  track_id: string;
  clip_id: string;
  clip_title: string;
  recorded_at: string | null;
  /** Seconds this face is on screen. */
  on_screen_s: number;
  crop_url: string | null;
  /** Faces that look like the same person or pet share a group; null when ungrouped or matching is off. */
  group_id: string | null;
  suggested: FaceSuggestion | null;
}

/** A hidden bystander, for the sheet that unhides them (listed newest clip first). */
export interface HiddenFace {
  track_id: string;
  clip_id: string;
  clip_title: string;
  recorded_at: string | null;
  crop_url: string | null;
}

/** `GET /api/people/overview`. */
export interface PeopleOverview {
  people: NamedPerson[];
  unnamed: UnnamedFace[];
  hidden_count: number;
  /** Hidden tracks, newest clip first. */
  hidden: HiddenFace[];
}

/** One row of `GET /api/shorts`, newest first. */
export interface ShortListItem {
  short_id: string;
  prompt: string;
  aspect: Aspect;
  target_s: number;
  status: ShortStatus;
  created_at: string;
  version_count: number;
  best_score: number | null;
  thumb_url: string | null;
  /** The most drafts the editor makes (a first cut plus its revisions); absent from older answers. */
  max_drafts?: number;
  /** The shown draft's post caption, trimmed; null when there is none (or from older answers). */
  caption: string | null;
  /** The production this short is the story cut of; null for a short made from moments. */
  production_id: string | null;
  /** That production's title; null with `production_id`. */
  production_title: string | null;
}

/** A named person (autocomplete row). */
export interface Person {
  person_id: string;
  name: string;
}

/** `PUT /api/tracks/{id}` request; send only the fields that change. */
export interface TrackUpdate {
  name?: string;
  hidden?: boolean;
}

/** `PUT /api/speakers/{id}` request. */
export interface SpeakerUpdate {
  display_name: string;
}

/** Output frame of a short. */
export type Aspect = '4:5' | '1:1';

/** One shot in a timeline. `in` / `out` are seconds on the source clip, inside the segment. */
export interface TimelineClip {
  segment_id: string;
  in: number;
  out: number;
  /** What the shot is about, for a punch-in; null when none. */
  subject: string | null;
  /** Zoom factor >= 1.0 (1.0 = no zoom). */
  punch_in: number;
  /** "Why this shot", from the agent. */
  reason: string;
}

/** Kind of change a revision made. */
export type RevisionAction = 'add' | 'remove' | 'swap' | 'trim' | 'reorder' | 'retime_captions';

/** One change in a revision, and the critique note it answers. */
export interface RevisionChange {
  action: RevisionAction;
  /** What changed, for example `"s7 → s9"`. */
  detail: string;
  /** Why, in words. */
  why: string;
  /** 0-based index into `notes` of the critique of version `from_version`; null if none. */
  note_index: number | null;
}

/** What a v2+ timeline changed relative to `from_version`. */
export interface Revision {
  from_version: number;
  changes: RevisionChange[];
}

/** A cut: shots, captions, post text and the agent's reasoning. */
export interface Timeline {
  aspect: Aspect;
  target_seconds: number;
  clips: TimelineClip[];
  captions: { style: 'phrase' | 'none'; source: 'transcript' };
  post: { caption: string; hashtags: string[] };
  /** Overall reasoning for this cut (<= 200 chars). */
  rationale: string;
  /** Null (or absent on the wire) on v1; required on v2+. */
  revision: Revision | null;
}

/** The five critique dimensions, each scored 0–10. */
export const CRITIQUE_DIMENSIONS = ['hook', 'pacing', 'continuity', 'captions', 'length'] as const;

/** One critique dimension. */
export type CritiqueDimension = (typeof CRITIQUE_DIMENSIONS)[number];

/** A timestamped problem in a preview. `at` is seconds on the preview. */
export interface CritiqueNote {
  at: number;
  issue: string;
  fix: string;
}

/** The agent's review of one preview. `total` is the sum of the scores (0–50). */
export interface Critique {
  version: number;
  scores: Record<CritiqueDimension, number>;
  total: number;
  notes: CritiqueNote[];
  verdict: 'accept' | 'revise';
}

/** Where a short is. */
export type ShortStatus = 'planning' | 'rendering' | 'critiquing' | 'revising' | 'ready' | 'failed';

/** A short and its final render. */
export interface Short {
  short_id: string;
  prompt: string;
  aspect: Aspect;
  target_s: number;
  status: ShortStatus;
  best_version: number | null;
  /** Final render URL; null until a final render finished (reset when a new one starts). */
  render_url: string | null;
}

/** One version of the cut, with its preview and critique. */
export interface ShortVersion {
  /** 1-based. */
  n: number;
  timeline: Timeline;
  preview_url: string | null;
  critique: Critique | null;
  score_total: number | null;
  /**
   * Exact props the renderer received for this version (Remotion Player input), or null.
   * Kept raw here and validated with the renderer's schema where the Player loads
   * (`hooks/usePlayerProps.ts`), so the schema and Remotion stay out of the main bundle.
   */
  composition_props: unknown;
}

/** Kind of agent step. */
export type AgentStepKind = 'plan' | 'tool_call' | 'tool_result' | 'critique' | 'revise' | 'final';

/** One row of the agent's step log (also the SSE `data`). */
export interface AgentStep {
  seq: number;
  kind: AgentStepKind;
  tool: string | null;
  /** The version this step works on, when there is one. */
  version: number | null;
  summary: string;
  at: string;
}

/** A candidate segment the short may use: bounds for trimming, thumb for the cards. */
export interface ShortSegment {
  segment_id: string;
  clip_id: string;
  start_s: number;
  end_s: number;
  thumb_url: string | null;
  description: string | null;
}

/** `GET /api/shorts/{id}` response. */
export interface ShortDetail {
  short: Short;
  versions: ShortVersion[];
  steps: AgentStep[];
  segments: ShortSegment[];
  /** The most drafts the editor makes (a first cut plus its revisions); absent from older answers. */
  max_drafts?: number;
}

/** `POST /api/shorts` request. */
export interface CreateShortRequest {
  prompt: string;
  segment_ids: string[];
  aspect: Aspect;
  target_s: number;
}

/** Shape of a production: `story` is 45-90 s in four acts, `short` is 10-30 s, one idea. */
export type ProductionFormat = 'story' | 'short';

/** The acts of a story, in play order. */
export const ACTS = ['hook', 'story', 'payoff', 'outro'] as const;

/** Part of the story a shot belongs to; shots run in this order. */
export type Act = (typeof ACTS)[number];

/** Where a production stands. `published` means the owner shared or downloaded it. */
export type ProductionStatus =
  | 'planning'
  | 'shooting'
  | 'cutting'
  | 'ready'
  | 'published'
  | 'failed';

/** `POST /api/productions` request. */
export interface CreateProductionRequest {
  /** 1-1000 characters. */
  brief: string;
  format: ProductionFormat;
  /** 9:16 versions are made at publish. */
  aspect: Aspect;
  /** Within the format's range. */
  target_s: number;
  /** Defaults to true when left out. */
  blur_bystanders?: boolean;
}

/** `POST /api/productions` response; the plan runs in the background (watch `/events`). */
export interface CreateProductionResponse {
  production_id: string;
}

/** One row of `GET /api/productions`, newest first. */
export interface ProductionListItem {
  production_id: string;
  title: string;
  format: ProductionFormat;
  aspect: Aspect;
  target_s: number;
  status: ProductionStatus;
  shot_count: number;
  covered_count: number;
  /** Titles of the shots still to film, in play order. */
  missing_titles: string[];
  /** The first shot's storyboard frame. */
  cover_url: string | null;
  created_at: string;
  /** Key art; null until drawn. */
  art_url: string | null;
  /** New art is being drawn. */
  art_drawing: boolean;
}

/** The production itself. */
export interface ProductionSummary {
  production_id: string;
  title: string;
  brief: string;
  format: ProductionFormat;
  aspect: Aspect;
  target_s: number;
  blur_bystanders: boolean;
  status: ProductionStatus;
  short_id: string | null;
  coverage_checked_at: string | null;
  /** Why planning failed, or what it could not do (frames, coverage). */
  error: string | null;
  created_at: string;
  /** Key art; null until drawn. */
  art_url: string | null;
  /** New art is being drawn. */
  art_drawing: boolean;
}

/** The library moment that covers a shot. */
export interface ShotMatch {
  segment_id: string;
  clip_id: string;
  clip_title: string;
  start_s: number;
  end_s: number;
  recorded_at: string | null;
  description: string;
  thumb_url: string;
}

/** One shot of a production's shot list. */
export interface ProductionShot {
  shot_id: string;
  /** 1-based play order. */
  ord: number;
  act: Act;
  title: string;
  /** One line: how to film it. */
  direction: string;
  tips: string[];
  duration_s: number;
  /** Storyboard frame (WebP); null until drawn. */
  board_url: string | null;
  /** The storyboard redrawn from the covering moment's hook frame; null until drawn. */
  footage_board_url: string | null;
  /** Null while the shot is still to film. */
  match: ShotMatch | null;
  match_reason: string | null;
  take_count: number;
}

/** `PUT /api/productions/{id}` body; the reply is the same `ProductionDetail` as `GET`. */
export interface UpdateProductionRequest {
  /** Trimmed with inner whitespace collapsed by the API; 1-80 characters. */
  title: string;
}

/** `GET` and `PUT /api/productions/{id}` response. */
export interface ProductionDetail {
  production: ProductionSummary;
  shots: ProductionShot[];
  covered_count: number;
  /** At least 3 shots or 60 % covered. */
  can_cut: boolean;
  /** A plan or coverage run is in flight (watch `/events`). */
  busy: boolean;
}

/** `POST /api/productions/{id}/coverage` and `/retry` response (202). */
/** `POST /api/productions/{id}/art/cover` (200): the platforms that got the key art as a cover; a platform at the 9-cover cap is skipped. */
export interface ArtCoverResponse {
  platforms: Platform[];
}

export interface StartedResponse {
  /** False when a run is in flight, or (coverage) the last check is under a minute old. */
  started: boolean;
}

/** `POST /api/productions/{id}/cut` response: the story short (the same one on every call). */
export interface CutResponse {
  short_id: string;
}

/** One shot of a story short's production; timeline clips map to acts by `segment_id`. */
export interface ActShot {
  ord: number;
  act: Act;
  title: string;
  duration_s: number;
  /** Null for a shot that was not filmed (it is not in the cut). */
  segment_id: string | null;
}

/** `GET /api/shorts/{id}/production` response (404 when the short is no production's story). */
export interface ShortProduction {
  production_id: string;
  title: string;
  status: ProductionStatus;
  shots: ActShot[];
}

/**
 * `GET /api/productions/{id}/events` SSE `data` payload (default `message` event). `step` is
 * `planning`, `shot_list`, `boards n/m`, `coverage` or `done`; the stream ends after `done` or any
 * failed step.
 */
export interface ProductionEvent {
  step: string;
  status: StepStatus;
}

/** A finishing effect on the short's subject. */
export type FinishEffect = 'none' | 'spotlight' | 'blur_bg';

/** `GET/PUT /api/shorts/{id}/finish` body: how a short is finished before rendering. */
export interface ShortFinish {
  /** Blur faces hidden in People; defaults to the production's choice, else true. */
  blur_bystanders: boolean;
  /** At most 80 characters; null for none. */
  title_text: string | null;
  speaker_colors: boolean;
  effect: FinishEffect;
  /** 9:16 exports follow each shot's subject instead of a centre crop (default true). */
  keep_subject: boolean;
}

/** Title font of a brand kit. */
export type TitleFont = 'bricolage' | 'geist';

/** A saved brand kit with signed images. */
export interface BrandKit {
  /** 1–3 `#rrggbb`, lower case; the first is the video accent. */
  colors: string[];
  title_font: TitleFont;
  logo_key: string | null;
  logo_url: string | null;
  /** At most 4. */
  ref_keys: string[];
  ref_urls: string[];
  updated_at: string;
}

/** `GET /api/brand` response; `kit` is null until saved (renders use the app defaults). */
export interface BrandResponse {
  kit: BrandKit | null;
}

/** `PUT /api/brand` request (answers with `BrandKit`). Keys come from `POST /api/brand/uploads`. */
export interface SaveBrandRequest {
  colors: string[];
  title_font: TitleFont;
  logo_key?: string | null;
  ref_keys?: string[];
}

/** `POST /api/brand/uploads` request. */
export interface BrandUploadRequest {
  kind: 'logo' | 'ref';
  /** Reference slot 0–3 (`ref` only). */
  slot?: number;
  content_type: 'image/png' | 'image/jpeg';
  /** Up to 5 MB. */
  size_bytes: number;
}

/** `POST /api/brand/uploads` response: PUT the file to `url`, then save `key` in the kit. */
export interface BrandUploadResponse {
  key: string;
  url: string;
}

/** The platforms, in the order the Publish screen lists them. */
export const PLATFORMS = ['tiktok', 'reels', 'shorts', 'feed'] as const;

/** Where a short is published (the owner posts it; nothing is posted for them). */
export type Platform = (typeof PLATFORMS)[number];

/** Frame of an export: TikTok, Reels and Shorts share one 9:16 render; the feed keeps the short's. */
export type ExportAspect = '4:5' | '1:1' | '9:16';

/** Where an export's render stands. */
export type ExportStatus = 'queued' | 'rendering' | 'ready' | 'failed';

/**
 * How a cover was drawn. The first five are picked by the user; `redrawn` comes from Redraw with
 * words and `key_art` from a production's Use as cover.
 */
export type CoverStyle =
  | 'bright'
  | 'close_detail'
  | 'dramatic'
  | 'illustrated'
  | 'brand_scene'
  | 'redrawn'
  | 'key_art'
  | 'cutout';

/** Every cover style the wire carries. */
export const COVER_STYLES: readonly CoverStyle[] = [
  'bright',
  'close_detail',
  'dramatic',
  'illustrated',
  'brand_scene',
  'redrawn',
  'key_art',
  'cutout',
];

/** The styles "Make 3 more" can ask for, in the order the Style chips list them. */
export const PICKABLE_COVER_STYLES = ['bright', 'close_detail', 'dramatic', 'illustrated', 'brand_scene'] as const;

/** A style "Make 3 more" can ask for. */
export type PickableCoverStyle = (typeof PICKABLE_COVER_STYLES)[number];

/** What is behind the subject of a cutout cover: a drawn scene, or the frame itself blurred. */
export type CutoutBackground = 'scene' | 'blur';

/** Every cutout background, in the order the Background switch lists them. */
export const CUTOUT_BACKGROUNDS: readonly CutoutBackground[] = ['scene', 'blur'];

/** The style that asks for one cutout cover (the real subject in front of the title). */
export const CUTOUT_STYLE = 'cutout' satisfies CoverStyle;

/** A style the Style chips offer: the "Make 3 more" styles, then Cutout. */
export type CoverChipStyle = PickableCoverStyle | typeof CUTOUT_STYLE;

/** One cover of an export. */
export interface CoverTile {
  /** Signed cover (WebP), without the title (a cutout cover has its title drawn in). */
  url: string;
  style: CoverStyle;
  /** The words a `redrawn` cover was drawn from; null otherwise. */
  instruction: string | null;
  /** A `cutout` cover's background; null for every other style. */
  background: CutoutBackground | null;
}

/** Where the title sits on the cover. */
export type CoverTitlePosition = 'top' | 'bottom';

/** The short title laid over the picked cover. */
export interface CoverTitle {
  /** 1–32 characters. */
  text: string;
  show: boolean;
  position: CoverTitlePosition;
}

/** `POST /api/shorts/{id}/exports` request (answers 202 with `StartedResponse`). */
export interface CreateExportsRequest {
  platforms: Platform[];
}

/** One platform's export. */
export interface ExportItem {
  platform: Platform;
  aspect: ExportAspect;
  version_n: number;
  status: ExportStatus;
  /** Signed video once ready. */
  render_url: string | null;
  /** A title for Shorts. */
  caption: string;
  /** 2,200 characters; 100 for Shorts. */
  caption_limit: number;
  hashtags: string[];
  /** The covers, in the order made; at most 9. `cover_pick` indexes this list. */
  covers: CoverTile[];
  cover_pick: number;
  cover_title: CoverTitle;
  /** The picked cover as it is published (titled when `show`); null while the titled still bakes. */
  download_cover_url: string | null;
  updated_at: string;
}

/** `GET /api/shorts/{id}/exports` response. */
export interface ExportsResponse {
  exports: ExportItem[];
  /** A publish or cover run is in flight (watch `/exports/events`). */
  busy: boolean;
}

/** `PUT /api/shorts/{id}/exports/{platform}` request (204); absent fields stay. */
export interface EditExportRequest {
  caption?: string;
  /** At most 8. */
  hashtags?: string[];
  cover_pick?: number;
  /** A change re-bakes the titled cover in the background. */
  cover_title?: CoverTitle;
}

/**
 * `POST /api/shorts/{id}/exports/{platform}/covers` body (optional; no body = the usual three).
 * `style: 'cutout'` makes one cutout cover, over `background` (default `scene`).
 */
export interface MoreCoversRequest {
  style?: CoverChipStyle;
  background?: CutoutBackground;
}

/** `POST /api/shorts/{id}/exports/{platform}/covers/{n}/redraw` body. */
export interface RedrawCoverRequest {
  /** 3–120 characters. */
  instruction: string;
}

/**
 * `GET /api/shorts/{id}/exports/events` SSE `data` payload. `step` is `exports`, `pack`,
 * `covers`, `render` or `done`; the stream ends after `done` or any failed step.
 */
export interface ExportEvent {
  step: string;
  status: StepStatus;
}

/** A step event of either Studio stream (plan or publish run); both carry the same shape. */
export type StudioStepEvent = ProductionEvent | ExportEvent;

/** Spend on one model. */
export interface ModelCost {
  model: string;
  calls: number;
  cost_usd: number;
}

/** `GET /api/costs` response: what the AI calls cost so far. */
export interface CostReport {
  total_usd: number;
  by_model: ModelCost[];
}

/** A point on a clip: a second, and where on the displayed frame (0..1 across, 0..1 down). */
export interface FramePoint {
  t_s: number;
  x: number;
  y: number;
}

/** `POST /api/clips/{id}/find` body. */
export type FindRequest = FramePoint;

/** Seconds of a clip an object is on screen. */
export interface SecondsRange {
  start_s: number;
  end_s: number;
}

/** The tapped object's outline: an SVG path in frame pixels of a `frame_w` × `frame_h` frame. */
export interface FindOutline {
  path: string;
  frame_w: number;
  frame_h: number;
}

/** One moment the object was found in; the tapped clip comes first. */
export interface FindHit {
  clip_id: string;
  clip_title: string;
  recorded_at: string | null;
  segment_id: string;
  start_s: number;
  end_s: number;
  thumb_url: string | null;
  score: number;
}

/** `POST /api/clips/{id}/find` response: what was tapped, where it is in view here, where else it is. */
export interface FindResponse {
  /** 1–3 lowercase words, for example `"mug"`. */
  label: string;
  /** Where it is in view in this clip, clip seconds. */
  in_view: SecondsRange;
  /** Null (or absent) when SAM found nothing at the point and a crop around the tap was searched. */
  outline: FindOutline | null;
  /** At most 12. */
  hits: FindHit[];
}

/** `POST /api/clips/{id}/cutout` body. */
export type CutoutRequest = FramePoint;

/** `POST /api/clips/{id}/cutout` response: the tapped thing as a transparent PNG and as a sticker. */
export interface CutoutResponse {
  label: string;
  png_url: string;
  /** The same cutout with a white outline. */
  sticker_url: string;
}

/** Where a short's subject tracking stands. */
export type ReframeStatus = 'idle' | 'running' | 'ready' | 'failed';

/** How well one shot's subject was followed. */
export interface ReframeShot {
  segment_id: string;
  subject: string;
  frames_tracked: number;
  frames_total: number;
  /** Seconds the subject was lost (the frame held still). */
  lost_s: number;
}

/** `GET /api/shorts/{id}/reframe` response. */
export interface ReframeResponse {
  status: ReframeStatus;
  shots: ReframeShot[];
}

/** Where a guide stands: `refused` = Spark judged the task `not_supported` (no steps made). */
export type GuideStatus = 'queued' | 'running' | 'ready' | 'failed' | 'refused';

/** The guide pipeline, in order; `stage` names the one running (V33 progress list). */
export const GUIDE_STAGES = ['steps', 'frames', 'highlight', 'voice', 'ready'] as const;

/** One pipeline stage. */
export type GuideStage = (typeof GUIDE_STAGES)[number];

/** Spark's safety label for the task in the clip. */
export type GuideSafety = 'everyday' | 'caution' | 'not_supported';

/** The control SAM circled on a step's image. */
export interface GuideHighlight {
  /** What was circled ("dial"). */
  label: string;
}

/** One step of a guide; every key is always present. */
export interface GuideStep {
  /** 1-based step number. */
  n: number;
  title: string;
  instruction: string;
  /** The step's span in the clip, seconds. */
  start_s: number;
  end_s: number;
  /** The second the step image was taken from. */
  key_s: number;
  /** The frame at `key_s`, with the ring already drawn in; null until made. */
  image_url: string | null;
  /** The spoken instruction (WAV); null until made. */
  audio_url: string | null;
  /** The 720p MP4 of `start_s`–`end_s` that ▶ Play shows over the photo; null until made. */
  clip_url: string | null;
  /** Null when SAM found no control to circle. */
  highlight: GuideHighlight | null;
}

/** One `GET /api/guides` row. */
export interface GuideSummary {
  id: string;
  clip_id: string;
  title: string;
  status: GuideStatus;
  /** The running stage; null unless queued or running. */
  stage: GuideStage | null;
  /** Why it failed; null unless failed. */
  error: string | null;
  step_count: number;
  cover_url: string | null;
  /** ISO-8601 UTC. */
  created_at: string;
  /** The source clip's title and length; null when unknown. */
  clip_title: string | null;
  clip_duration_s: number | null;
}

/** `GET /api/guides/{id}` response. */
export interface Guide {
  id: string;
  clip_id: string;
  title: string;
  status: GuideStatus;
  stage: GuideStage | null;
  error: string | null;
  /** Null until Spark has judged the clip. */
  safety: GuideSafety | null;
  /** What made it `not_supported` ("taking medication"); null otherwise. */
  safety_reason: string | null;
  language: string | null;
  steps: GuideStep[];
  clip_title: string | null;
  clip_duration_s: number | null;
}

/** `POST /api/clips/{id}/guide` response (202). */
export interface StartGuideResponse {
  guide_id: string;
  status: GuideStatus;
}

/** `PATCH /api/guides/{id}` body: the new title (trimmed by the server, 1–60 characters). */
export interface RenameGuideRequest {
  title: string;
}

/** `PATCH /api/guides/{id}/steps/{n}` body: only the fields being changed. */
export interface GuideStepEdit {
  title?: string;
  instruction?: string;
}

/**
 * Returns `name` as a typed code, failing at import time when `error-codes.json` lacks it.
 * @throws Error when `name` is not a listed code (the list and the caller drifted).
 */
function knownCode(name: string): ErrorCode {
  if (!isErrorCode(name)) throw new Error(`${name} is missing from error-codes.json`);
  return name;
}

/** Codes the web branches on. Each is checked against `error-codes.json` when loaded. */
export const ERROR = {
  NOT_FOUND: knownCode('NOT_FOUND'),
  FORBIDDEN: knownCode('FORBIDDEN'),
  UNAUTHORIZED: knownCode('UNAUTHORIZED'),
  UPLOAD_INCOMPLETE: knownCode('UPLOAD_INCOMPLETE'),
  INTERNAL: knownCode('INTERNAL'),
} as const;
