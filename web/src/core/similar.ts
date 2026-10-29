// Near-copies and same-moment footage (Phase 29, mocks V52–V54): which badge a tile wears, the
// Copies view's count and size line, the Gallery header's copy counts, the "Looks like a copy"
// sentence with its trimmed hint, and the "2 angles of this moment" lines. Pure: clips and links
// come in as arguments; the zone is pinned by tests.
import type { ClipLink, ClipSummary } from '../services/api/types';
import { isCopy } from './clip-view';
import { PROCESSING_COPY } from './copy';
import { formatBytes, formatDuration } from './format';

/** The words of the copy and angles boxes and the Copies view. */
export const SIMILAR_COPY = {
  copyTitle: 'Looks like a copy',
  copyNote: 'Copies are not searched or counted, and no AI runs on them until you keep them.',
  theOriginal: 'the original',
  removeCopy: 'Remove this copy',
  keepBoth: 'Keep both',
  removeAll: 'Remove all copies…',
  copiesFilter: 'Copies',
} as const;

/** A tile badge: the warm copy tone or the accent angles tone. */
export interface TileBadge {
  label: string;
  tone: 'copy' | 'angles';
}

/**
 * "2 angles": this clip and its same-moment links.
 * @param angles - Same-moment links (the list item's `angles`).
 * @returns The words.
 */
export const anglesLabel = (angles: number): string => `${String(angles + 1)} angles`;

/**
 * The badge a Gallery tile wears: "Duplicate" or "Near-copy" (warm), else "2 angles" (accent) when
 * the clip has same-moment links, else none.
 * @param clip - The clip.
 * @returns The badge, or null.
 */
export function tileBadge(clip: Pick<ClipSummary, 'status' | 'near_copy_of' | 'angles'>): TileBadge | null {
  if (clip.status === 'duplicate') return { label: PROCESSING_COPY.duplicate, tone: 'copy' };
  if (isCopy(clip)) return { label: PROCESSING_COPY.nearCopy, tone: 'copy' };
  if (clip.angles > 0) return { label: anglesLabel(clip.angles), tone: 'angles' };
  return null;
}

/**
 * The clips the Copies chip lists: duplicates and near-copies, in library order.
 * @param clips - The library.
 * @returns The copies.
 */
export const copiesIn = (clips: readonly ClipSummary[]): ClipSummary[] => clips.filter(isCopy);

const plural = (n: number, one: string, many: string) => `${String(n)} ${n === 1 ? one : many}`;

/**
 * The Copies view's strip: "3 copies use 1.8 GB. Removing them keeps the originals."
 * @param copies - The copies (`copiesIn`).
 * @returns The line.
 */
export function copiesSizeLine(copies: readonly ClipSummary[]): string {
  const bytes = formatBytes(copies.reduce((sum, clip) => sum + clip.size_bytes, 0));
  return copies.length === 1
    ? `1 copy uses ${bytes}. Removing it keeps the original.`
    : `${String(copies.length)} copies use ${bytes}. Removing them keeps the originals.`;
}

/**
 * The Gallery header in the Copies view: "3 copies of other clips".
 * @param count - Copies.
 * @returns The line.
 */
export const copiesHeadLine = (count: number): string => (count === 1 ? '1 copy of another clip' : `${String(count)} copies of other clips`);

/**
 * The header's copy counts: ["2 near-copies", "1 duplicate"], each left out at zero.
 * @param clips - The library.
 * @returns The parts, in that order.
 */
export function copyCountParts(clips: readonly ClipSummary[]): string[] {
  const duplicates = clips.filter((clip) => clip.status === 'duplicate').length;
  const nearCopies = copiesIn(clips).length - duplicates;
  return [
    nearCopies > 0 ? plural(nearCopies, 'near-copy', 'near-copies') : '',
    duplicates > 0 ? plural(duplicates, 'duplicate', 'duplicates') : '',
  ].filter((part) => part !== '');
}

/** A copy shorter than this share of its original reads as trimmed. */
const TRIM_SHARE = 0.95;

/**
 * Whether a copy looks trimmed: at least a second and 5% shorter than its original.
 * @param copyS - The copy's length, seconds, or null.
 * @param originalS - The original's length, seconds, or null.
 * @returns True when both are known and the copy is clearly shorter.
 */
export function looksTrimmed(copyS: number | null, originalS: number | null): boolean {
  if (copyS === null || originalS === null) return false;
  return originalS - copyS >= 1 && copyS < originalS * TRIM_SHARE;
}

const zoneOpt = (timeZone?: string) => (timeZone === undefined ? {} : { timeZone });

const validDate = (iso: string | null): Date | null => {
  const date = iso === null ? null : new Date(iso);
  return date === null || Number.isNaN(date.getTime()) ? null : date;
};

/**
 * "20 Oct".
 * @param iso - ISO instant, or null.
 * @param timeZone - IANA zone; tests pin it.
 * @returns The day, or "" when unknown.
 */
export function shortDay(iso: string | null, timeZone?: string): string {
  const date = validDate(iso);
  return date === null ? '' : new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', ...zoneOpt(timeZone) }).format(date);
}

/** The "Looks like a copy" sentence, split so the page can set the title in bold. */
export interface CopySentence {
  /** "94% the same as ". */
  before: string;
  /** The original's title. */
  title: string;
  /** " (1:48), filmed 20 Oct." */
  after: string;
  /** "This one is shorter: it looks trimmed.", or null. */
  trimmed: string | null;
}

/**
 * "94% the same as **Beach walk, Koh Samui** (1:48), filmed 20 Oct. This one is shorter: it looks
 * trimmed."
 * @param copyS - This clip's length, seconds, or null.
 * @param original - The `near_copy_of` link.
 * @param timeZone - IANA zone; tests pin it.
 * @returns The parts.
 */
export function copySentence(copyS: number | null, original: ClipLink, timeZone?: string): CopySentence {
  const length = original.duration_s === null ? '' : ` (${formatDuration(original.duration_s)})`;
  const day = shortDay(original.recorded_at, timeZone);
  return {
    before: `${String(Math.round(original.score * 100))}% the same as `,
    title: original.title,
    after: `${length}${day === '' ? '' : `, filmed ${day}`}.`,
    trimmed: looksTrimmed(copyS, original.duration_s) ? 'This one is shorter: it looks trimmed.' : null,
  };
}

/**
 * The link the copy box is about: the older clip this one copies.
 * @param links - The clip detail's links.
 * @returns The `near_copy_of` link, or null.
 */
export const originalLink = (links: readonly ClipLink[]): ClipLink | null => links.find((link) => link.kind === 'near_copy_of') ?? null;

/**
 * The same-moment links, in the order the server sent them.
 * @param links - The clip detail's links.
 * @returns The `same_moment` links.
 */
export const sameMomentLinks = (links: readonly ClipLink[]): ClipLink[] => links.filter((link) => link.kind === 'same_moment');

/**
 * The original's small line: "1 copy of this clip", "2 copies of this clip".
 * @param links - The clip detail's links.
 * @returns The line, or null when nothing copies this clip.
 */
export function copiedByLine(links: readonly ClipLink[]): string | null {
  const count = links.filter((link) => link.kind === 'copied_by').length;
  return count === 0 ? null : `${plural(count, 'copy', 'copies')} of this clip`;
}

/**
 * "40 seconds apart", "1 second apart", "3 minutes apart", "1 minute apart". Under a minute reads in
 * seconds, else in whole minutes.
 * @param seconds - The gap, seconds (sign ignored).
 * @returns The words.
 */
export function apartWords(seconds: number): string {
  const gap = Math.round(Math.abs(seconds));
  if (gap < 60) return `${plural(gap, 'second', 'seconds')} apart`;
  return `${plural(Math.round(gap / 60), 'minute', 'minutes')} apart`;
}

/**
 * "Also filmed on another device, 40 seconds apart." With more links, the widest gap: "Also
 * filmed on 2 other devices, up to 3 minutes apart." The gap is left out when a time is unknown.
 * @param recordedAt - This clip's recording time, or null.
 * @param links - The same-moment links (at least one).
 * @returns The line.
 */
export function anglesLine(recordedAt: string | null, links: readonly ClipLink[]): string {
  const here = validDate(recordedAt);
  const gaps = links.map((link) => validDate(link.recorded_at)).map((there) => (here === null || there === null ? null : Math.abs(there.getTime() - here.getTime()) / 1000));
  const known = gaps.every((gap) => gap !== null) ? gaps : [];
  const widest = known.length === 0 ? null : Math.max(...known);
  const devices = links.length === 1 ? 'another device' : `${String(links.length)} other devices`;
  if (widest === null) return `Also filmed on ${devices}.`;
  return `Also filmed on ${devices}, ${links.length === 1 ? '' : 'up to '}${apartWords(widest)}.`;
}

/**
 * The original the copy box names: the detail's `near_copy_of` link, else (detail not loaded, or
 * a link the detail left out) the list item's `near_copy_of` with no thumb, time or length.
 * @param clip - The clip.
 * @param links - The detail's links; [] while it loads.
 * @returns The original, or null when the clip copies nothing.
 */
export function originalOf(clip: Pick<ClipSummary, 'near_copy_of'>, links: readonly ClipLink[]): ClipLink | null {
  const link = originalLink(links);
  if (link !== null) return link;
  const near = clip.near_copy_of;
  return near === null ? null : { ...near, kind: 'near_copy_of', recorded_at: null, thumb_url: null, duration_s: null };
}

/** One clip of a moment in the angles box. */
export interface MomentRow {
  clipId: string;
  title: string;
  thumbUrl: string | null;
  /** "Filmed 20 Oct, 18:12 · 0:52". */
  line: string;
  /** The clip on screen: drawn lit, not a link. */
  isCurrent: boolean;
}

const timeOf = (iso: string | null) => validDate(iso)?.getTime() ?? Number.POSITIVE_INFINITY;

/**
 * The clips of one moment, this one included, in filming order (unknown times last).
 * @param clip - The clip on screen.
 * @param links - Its same-moment links.
 * @param timeZone - IANA zone; tests pin it.
 * @returns The rows.
 */
export function momentRows(clip: ClipSummary, links: readonly ClipLink[], timeZone?: string): MomentRow[] {
  const rows = [
    { clipId: clip.clip_id, title: clip.title, thumbUrl: clip.thumb_url, at: clip.recorded_at, length: clip.duration_s, isCurrent: true },
    ...links.map((link) => ({ clipId: link.clip_id, title: link.title, thumbUrl: link.thumb_url, at: link.recorded_at, length: link.duration_s, isCurrent: false })),
  ];
  return rows
    .map((row, index) => ({ row, index }))
    .sort((a, b) => timeOf(a.row.at) - timeOf(b.row.at) || a.index - b.index)
    .map(({ row }) => ({ clipId: row.clipId, title: row.title, thumbUrl: row.thumbUrl, line: angleRowLine(row.at, row.length, timeZone), isCurrent: row.isCurrent }));
}

/**
 * "2 angles of this moment".
 * @param count - Clips of the moment, this one included.
 * @returns The title.
 */
export const anglesTitle = (count: number): string => `${String(count)} angles of this moment`;

/**
 * The note under the angles: both or all stay in search.
 * @param count - Clips of the moment, this one included.
 * @returns The note.
 */
export const anglesNote = (count: number): string =>
  count === 2
    ? 'Both stay in your library and in search. A short can use either angle.'
    : 'They all stay in your library and in search. A short can use any angle.';

/**
 * A linked clip's line: "Filmed 20 Oct, 18:12 · 0:52".
 * @param recordedAt - Its recording time, or null.
 * @param durationS - Its length, seconds, or null.
 * @param timeZone - IANA zone; tests pin it.
 * @returns The line ("" when both are unknown).
 */
export function angleRowLine(recordedAt: string | null, durationS: number | null, timeZone?: string): string {
  const date = validDate(recordedAt);
  const time =
    date === null ? '' : new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23', ...zoneOpt(timeZone) }).format(date);
  const filmed = date === null ? '' : `Filmed ${shortDay(recordedAt, timeZone)}, ${time}`;
  return [filmed, durationS === null ? '' : formatDuration(durationS)].filter((part) => part !== '').join(' · ');
}

/** What "Remove all copies…" asks. */
export function removeCopiesCopy(count: number): { title: string; body: string; confirmLabel: string } {
  return count === 1
    ? { title: 'Remove this copy?', body: 'Removes the copy and its files. The original stays.', confirmLabel: 'Remove copy' }
    : {
        title: `Remove ${String(count)} copies?`,
        body: `Removes these ${String(count)} copies and their files. The originals stay. This can’t be undone.`,
        confirmLabel: `Remove ${String(count)} copies`,
      };
}

/**
 * The toast after removing copies: "Copy removed", "3 copies removed", or which failed.
 * @param removed - Copies removed.
 * @param failed - Copies still there.
 * @returns The title.
 */
export function copiesRemovedTitle(removed: number, failed: number): string {
  const total = removed + failed;
  if (failed === 0) return total === 1 ? 'Copy removed' : `${String(total)} copies removed`;
  return total === 1 ? 'Could not remove the copy' : `Could not remove ${String(failed)} of ${String(total)} copies`;
}

/**
 * "Removing 2 of 3…" while a run goes, for the confirm's busy button.
 * @param progress - The run's progress.
 * @returns The words.
 */
export const removingLabel = (progress: { done: number; total: number }): string =>
  progress.total === 1 ? 'Removing…' : `Removing ${String(Math.min(progress.done + 1, progress.total))} of ${String(progress.total)}…`;
