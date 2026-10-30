// The Mac's universal search bar (redesign v2, SearchBar board): what its results popover shows
// for a query. Speech rows (a line someone said, with the match marked), Moments rows (what the
// moment shows), title chips for clips, shorts and projects, and "See all N results in the
// Gallery"; plus the scope menu's filters, the keyboard's moving highlight and where each row goes.
import { SEGMENT_COPY } from './copy';
import { photoPagePath } from './photos';
import type { ClipDetail, ClipSummary, Project, ProjectColor, SearchResult, ShortListItem, Turn } from '../services/api/types';
import { librarySearchPath } from './library-query';
import { shortTitle } from './shorts-list';

/** What the scope button keeps: everything, one kind of hit, or one project's clips. */
export type SearchScope =
  | { kind: 'everything' }
  | { kind: 'speech' }
  | { kind: 'moments' }
  | { kind: 'faces' }
  | { kind: 'project'; projectId: string; name: string };

/** The default scope. */
export const EVERYTHING: SearchScope = { kind: 'everything' };

/**
 * The scope button's label.
 * @param scope - The scope.
 * @returns "Everything", "Speech", "Moments", "Faces" or the project's name.
 */
export function scopeLabel(scope: SearchScope): string {
  switch (scope.kind) {
    case 'everything':
      return 'Everything';
    case 'speech':
      return 'Speech';
    case 'moments':
      return 'Moments';
    case 'faces':
      return 'Faces';
    case 'project':
      return scope.name;
  }
}

/** Rows each group shows before "See all". */
export const BAR_ROWS_PER_GROUP = 3;
/** Title chips of each kind (clips, shorts, projects). */
export const BAR_CHIPS_PER_KIND = 3;
/** Shortest query the bar searches, characters (one letter would cost a search for nothing). */
export const BAR_MIN_QUERY = 2;

/**
 * The words of a query, lower case, without repeats; words of one character are left out.
 * @param query - What was typed.
 * @returns The words.
 */
export function queryWords(query: string): string[] {
  const words = query.toLowerCase().split(/[^\p{L}\p{N}']+/u).filter((word) => word.length >= 2);
  return [...new Set(words)];
}

/** Where the query matched a text: start and end offsets, end excluded. */
export type MatchRange = readonly [number, number];

const isWordChar = (char: string | undefined) => char !== undefined && /[\p{L}\p{N}]/u.test(char);

/**
 * Where the query's words start a word of `text`, ignoring case. Matches with only spaces between
 * them join into one range, so "Happy happy birthday" is one highlight for "happy birthday".
 * @param text - The line.
 * @param words - From `queryWords`.
 * @returns Sorted ranges that do not overlap.
 */
export function matchRanges(text: string, words: readonly string[]): MatchRange[] {
  const lower = text.toLowerCase();
  const found: [number, number][] = [];
  for (const word of words) {
    for (let at = lower.indexOf(word); at !== -1; at = lower.indexOf(word, at + 1)) {
      if (!isWordChar(lower[at - 1])) found.push([at, at + word.length]);
    }
  }
  found.sort((a, b) => a[0] - b[0]);
  const merged: [number, number][] = [];
  for (const range of found) {
    const last = merged.at(-1);
    if (last !== undefined && (range[0] <= last[1] || text.slice(last[1], range[0]).trim() === '')) {
      last[1] = Math.max(last[1], range[1]);
    } else {
      merged.push([range[0], range[1]]);
    }
  }
  return merged;
}

/** A piece of a highlighted line. */
export interface LinePart {
  text: string;
  isMatch: boolean;
}

/**
 * Cuts a line into plain and matched pieces.
 * @param text - The line.
 * @param ranges - From `matchRanges`.
 * @returns The pieces in order; empty pieces are left out.
 */
export function highlightParts(text: string, ranges: readonly MatchRange[]): LinePart[] {
  const parts: LinePart[] = [];
  let at = 0;
  for (const [start, end] of ranges) {
    if (start > at) parts.push({ text: text.slice(at, start), isMatch: false });
    parts.push({ text: text.slice(start, end), isMatch: true });
    at = end;
  }
  if (at < text.length) parts.push({ text: text.slice(at), isMatch: false });
  return parts;
}

/** One row of the popover: a moment found by search, as Speech or as a Moment, or a photo. */
export interface BarHit {
  kind: 'speech' | 'moment' | 'photo';
  result: SearchResult;
  /** The line shown: what was said, or what the moment shows. */
  line: string;
  /** Where the row opens the clip, seconds. */
  at: number;
}

/**
 * The transcript turn that makes a result a Speech hit: one said during the moment (overlapping
 * its start and end) whose text contains a word of the query.
 * @param result - The search result.
 * @param detail - Its clip's detail.
 * @param words - From `queryWords`.
 * @returns The first such turn, or null.
 */
export function speechTurn(result: SearchResult, detail: ClipDetail, words: readonly string[]): Turn | null {
  return (
    detail.turns.find((turn) => turn.start_s < result.end_s && turn.end_s > result.start_s && matchRanges(turn.text, words).length > 0) ??
    null
  );
}

/**
 * Sorts results into Speech and Moments. The search answer does not say whether a moment matched
 * on what was said or on what was seen, so the rule reads the clip's transcript: a result is Speech
 * when a line said during it contains a word of the query (the row quotes that line and opens at
 * it); every other result is a Moment, shown with its segment's description (or the rerank's
 * reason, or the clip's title when neither is known).
 * @param results - The answer, in rank order.
 * @param details - The results' clips, by id.
 * @param words - From `queryWords`.
 * A photo is neither: it goes to Photos, shown with the rerank's reason (or its title).
 * @returns The three groups, each in rank order.
 */
export function groupHits(
  results: readonly SearchResult[],
  details: ReadonlyMap<string, ClipDetail>,
  words: readonly string[],
): { speech: BarHit[]; moments: BarHit[]; photos: BarHit[] } {
  const speech: BarHit[] = [];
  const moments: BarHit[] = [];
  const photos: BarHit[] = [];
  for (const result of results) {
    if (result.kind === 'photo') {
      photos.push({ kind: 'photo', result, line: result.reason ?? result.clip_title, at: 0 });
      continue;
    }
    const detail = details.get(result.clip_id);
    const turn = detail === undefined ? null : speechTurn(result, detail, words);
    if (turn !== null) {
      speech.push({ kind: 'speech', result, line: turn.text, at: turn.start_s });
      continue;
    }
    const description = detail?.segments.find((segment) => segment.segment_id === result.segment_id)?.description ?? null;
    moments.push({ kind: 'moment', result, line: description ?? result.reason ?? result.clip_title, at: result.start_s });
  }
  return { speech, moments, photos };
}

/**
 * The results a scope keeps before grouping: a project keeps its clips' moments; Faces keeps the
 * moments where a named person whose name holds a word of the query is on screen.
 * @param results - The answer.
 * @param scope - The scope.
 * @param words - From `queryWords`.
 * @param projectClipIds - The project's clips (for a project scope).
 * @returns The kept results, in order.
 */
export function scopeResults(
  results: readonly SearchResult[],
  scope: SearchScope,
  words: readonly string[],
  projectClipIds: ReadonlySet<string>,
): SearchResult[] {
  switch (scope.kind) {
    case 'project':
      return results.filter((result) => projectClipIds.has(result.clip_id));
    case 'faces':
      return results.filter((result) => result.faces.some((face) => matchRanges(face.name, words).length > 0));
    default:
      return [...results];
  }
}

/** A title chip: a clip, short or project whose name matches the query. */
export interface BarChip {
  kind: 'clip' | 'short' | 'project';
  id: string;
  label: string;
  /** The project's colour (project chips only). */
  color: ProjectColor | null;
}

/** Words too common to match a title on their own. */
const COMMON = new Set(['the', 'and', 'for', 'with', 'from', 'was', 'who', 'what', 'when', 'where', 'that', 'this', 'there', 'said', 'saw']);

/** How many of `words` (3+ letters, not common) start a word of `title`. */
function titleScore(title: string, words: readonly string[]): number {
  return words.filter((word) => word.length >= 3 && !COMMON.has(word) && matchRanges(title, [word]).length > 0).length;
}

function best<T>(items: readonly T[], title: (item: T) => string, words: readonly string[]): T[] {
  return items
    .map((item) => ({ item, score: titleScore(title(item), words) }))
    .filter((scored) => scored.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, BAR_CHIPS_PER_KIND)
    .map((scored) => scored.item);
}

/** What the chips are picked from. */
export interface ChipSources {
  clips: readonly ClipSummary[];
  shorts: readonly ShortListItem[];
  projects: readonly Project[];
}

/**
 * The "Clips, shorts and projects" chips: titles (a short's as the Shorts list names it) holding
 * a word of the query (3+ letters, not a common word), best match first, at most three of each
 * kind, clips then shorts then projects.
 * Only Everything and a project scope show chips; a project scope keeps its own clips only. A
 * duplicate upload is left out (its original has the same title).
 * @param words - From `queryWords`.
 * @param sources - The loaded lists.
 * @param scope - The scope.
 * @returns The chips.
 */
export function titleChips(words: readonly string[], sources: ChipSources, scope: SearchScope): BarChip[] {
  if (scope.kind !== 'everything' && scope.kind !== 'project') return [];
  const projectId = scope.kind === 'project' ? scope.projectId : null;
  const originals = sources.clips.filter((clip) => clip.duplicate_of === null);
  const clips = projectId === null ? originals : originals.filter((clip) => clip.project_ids.includes(projectId));
  const clipChips = best(clips, (clip) => clip.title, words).map(
    (clip): BarChip => ({ kind: 'clip', id: clip.clip_id, label: clip.title, color: null }),
  );
  if (projectId !== null) return clipChips;
  const shortChips = best(sources.shorts, shortTitle, words).map(
    (short): BarChip => ({ kind: 'short', id: short.short_id, label: `Short: ${shortTitle(short)}`, color: null }),
  );
  const projectChips = best(sources.projects, (project) => project.name, words).map(
    (project): BarChip => ({ kind: 'project', id: project.project_id, label: `${SEGMENT_COPY.chipPrefix}${project.name}`, color: project.color }),
  );
  return [...clipChips, ...shortChips, ...projectChips];
}

/** What the popover shows for a finished search. */
export interface BarView {
  speech: BarHit[];
  moments: BarHit[];
  /** Photos found (Everything and Moments only). */
  photos: BarHit[];
  chips: BarChip[];
  /** What "See all N results in the Gallery" counts: the moments the Gallery will list. */
  total: number;
}

/**
 * The popover's content.
 * @param results - The answer.
 * @param details - The results' clips, by id.
 * @param query - The query.
 * @param scope - The scope.
 * @param sources - The clip, short and project lists.
 * @returns Speech and Moments (each cut to `BAR_ROWS_PER_GROUP` later by the view), the chips and
 *   the Gallery's count (a project scope counts the project's moments, like the Gallery does).
 */
export function barView(
  results: readonly SearchResult[],
  details: ReadonlyMap<string, ClipDetail>,
  query: string,
  scope: SearchScope,
  sources: ChipSources,
): BarView {
  const words = queryWords(query);
  const projectClipIds = new Set(
    scope.kind === 'project' ? sources.clips.filter((clip) => clip.project_ids.includes(scope.projectId)).map((clip) => clip.clip_id) : [],
  );
  const kept = scopeResults(results, scope, words, projectClipIds);
  const { speech, moments, photos } = groupHits(kept, details, words);
  const total = scope.kind === 'project' ? kept.length : results.length;
  return {
    speech: scope.kind === 'moments' ? [] : speech,
    moments: scope.kind === 'speech' ? [] : moments,
    photos: scope.kind === 'everything' || scope.kind === 'moments' ? photos : [],
    chips: titleChips(words, sources, scope),
    total,
  };
}

/** One row the arrow keys move between. */
export type BarItem = { kind: 'hit'; hit: BarHit } | { kind: 'chip'; chip: BarChip } | { kind: 'all' };

/**
 * The rows in screen order: shown Speech rows, shown Moments rows, shown Photos rows, the chips,
 * then "See all".
 * @param view - From `barView`.
 * @returns The rows.
 */
export function barItems(view: BarView): BarItem[] {
  return [
    ...view.speech.slice(0, BAR_ROWS_PER_GROUP).map((hit): BarItem => ({ kind: 'hit', hit })),
    ...view.moments.slice(0, BAR_ROWS_PER_GROUP).map((hit): BarItem => ({ kind: 'hit', hit })),
    ...view.photos.slice(0, BAR_ROWS_PER_GROUP).map((hit): BarItem => ({ kind: 'hit', hit })),
    ...view.chips.map((chip): BarItem => ({ kind: 'chip', chip })),
    { kind: 'all' },
  ];
}

/**
 * The highlighted row after ↑ or ↓; it wraps around at both ends.
 * @param index - The highlighted row now.
 * @param count - How many rows there are.
 * @param step - 1 for ↓, -1 for ↑.
 * @returns The next row, or 0 when there are none.
 */
export function moveIndex(index: number, count: number, step: 1 | -1): number {
  if (count <= 0) return 0;
  return (((index + step) % count) + count) % count;
}

/**
 * The page of a clip, short or project.
 * @param kind - Which.
 * @param id - Its id.
 * @returns `/clips/{id}`, `/editor/{id}` or `/projects/{id}`.
 */
export function openPath(kind: BarChip['kind'], id: string): string {
  const safe = encodeURIComponent(id);
  if (kind === 'clip') return `/clips/${safe}`;
  return kind === 'short' ? `/editor/${safe}` : `/projects/${safe}`;
}

/**
 * Where a row goes: a hit opens its clip at the moment (a photo opens its page), a clip chip its clip, a short its page, a
 * project its page, and "See all" the Gallery's results for the query (kept to the project for a
 * project scope).
 * @param item - The row.
 * @param query - The query.
 * @param scope - The scope.
 * @returns The path.
 */
export function itemPath(item: BarItem, query: string, scope: SearchScope): string {
  switch (item.kind) {
    case 'hit':
      return item.hit.result.photo_id !== null
        ? photoPagePath(item.hit.result.photo_id)
        : `/clips/${encodeURIComponent(item.hit.result.clip_id)}?t=${String(item.hit.at)}`;
    case 'chip':
      return openPath(item.chip.kind, item.chip.id);
    case 'all':
      return librarySearchPath(query, scope.kind === 'project' ? scope.projectId : null);
  }
}

/**
 * Whether the shell draws the bar itself on a page that has no columns. The compose, finish and
 * publish pages keep their own action bar fixed at the bottom edge, where the search bar would sit, so they have none (a page drawn in columns always has the bar).
 * @param path - The location's path.
 * @returns True when the shell draws it.
 */
export function hasShellSearchBar(path: string): boolean {
  return !(path === '/editor' || /^\/editor\/[^/]+\/(finish|publish)$/.test(path));
}
