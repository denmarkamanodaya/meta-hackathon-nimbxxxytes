// Studio view rules (P5, M4): where the editor is on a short that is still being made ("Checking
// draft 2 of 3", drawn as a 3-part bar, one part per draft), and the Mac inspector's summary line
// and editor's note for the selected short.
import type { ShortDetail, ShortStatus, ShortVersion } from '../services/api/types';

/** The most drafts a short gets: a first cut plus up to two revisions (the editor's limit). */
export const MAX_DRAFTS = 3;

/** What the editor is doing to which draft. */
export interface WorkingDraft {
  /** 1-based draft the editor works on now. */
  draft: number;
  /** "Planning", "Rendering", "Checking", "Revising". */
  verb: string;
}

const VERB: Partial<Record<ShortStatus, string>> = {
  planning: 'Planning',
  rendering: 'Rendering',
  critiquing: 'Checking',
  revising: 'Revising',
};

/**
 * Where the editor is on a working short.
 * @param status - The short's status.
 * @param versionCount - Drafts made so far.
 * @returns The draft and verb, or null for a short that is not working.
 */
export function workingDraft(status: ShortStatus, versionCount: number): WorkingDraft | null {
  const verb = VERB[status];
  if (verb === undefined) return null;
  const draft = status === 'planning' ? 1 : status === 'revising' ? versionCount + 1 : Math.max(1, versionCount);
  return { draft: Math.min(MAX_DRAFTS, draft), verb };
}

/**
 * "Checking draft 2 of 3" (the Mac tile overlay).
 * @param working - Where the editor is.
 * @returns The label.
 */
export const draftStepLabel = (working: WorkingDraft): string =>
  `${working.verb} draft ${String(working.draft)} of ${String(MAX_DRAFTS)}`;

/**
 * "Editor is checking draft 2 of 3" (the phone's working card).
 * @param working - Where the editor is.
 * @returns The line.
 */
export const editorAtWorkLine = (working: WorkingDraft): string => `Editor is ${draftStepLabel(working).toLowerCase()}`;

/**
 * The inspector's line: "3 drafts · from 4 moments in 2 clips".
 * @param detail - The short.
 * @param shown - The draft shown (its shots are counted).
 * @returns The line.
 */
export function inspectorLine(detail: ShortDetail, shown: ShortVersion): string {
  const drafts = `${String(detail.versions.length)} ${detail.versions.length === 1 ? 'draft' : 'drafts'}`;
  const ids = new Set(shown.timeline.clips.map((shot) => shot.segment_id));
  const clips = new Set(detail.segments.filter((segment) => ids.has(segment.segment_id)).map((segment) => segment.clip_id));
  if (ids.size === 0) return drafts;
  const moments = `${String(ids.size)} ${ids.size === 1 ? 'moment' : 'moments'}`;
  return clips.size === 0 ? `${drafts} · from ${moments}` : `${drafts} · from ${moments} in ${String(clips.size)} ${clips.size === 1 ? 'clip' : 'clips'}`;
}

/**
 * The editor's note on a draft: what the revision fixed, else the cut's reasoning.
 * @param shown - The draft.
 * @returns For example "Draft 3: the opening was slow; it now starts on the pour".
 */
export function editorNote(shown: ShortVersion): string {
  const why = shown.timeline.revision?.changes[0]?.why;
  return why === undefined || why.trim() === '' ? shown.timeline.rationale : `Draft ${String(shown.n)}: ${why}`;
}
