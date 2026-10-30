// Projects' rules on the client (redesign v2, Projects board; shown as Segments since 2026-10-30):
// the name rule the API enforces (checked here first so the sheet can say why before sending), the
// colour names, the words of the segment header and the New segment sheet, and which colour a new
// one starts with. A segment holds clips, recordings, documents and photos.
import { PROJECT_COLORS, type ClipSummary, type Project, type ProjectColor } from '../services/api/types';
import { SEGMENT_COPY, tooManyCharacters } from './copy';
import { formatBytes, formatDuration } from './format';
import { clipCount } from './gallery';
import { docCount } from './gallery-items';
import { recordingCount } from './ilisten/listens';
import { photoCount } from './photos';

/** Longest name, characters (the API's limit). */
export const PROJECT_NAME_MAX = 60;

/** Each colour's accessible name. */
export const PROJECT_COLOR_LABEL: Readonly<Record<ProjectColor, string>> = {
  orange: 'Orange',
  green: 'Green',
  blue: 'Blue',
  purple: 'Purple',
  pink: 'Pink',
  grey: 'Grey',
};

/**
 * Why a name cannot be used, or null when it can: trimmed, 1–60 characters, and not the name of
 * another of the user's projects ignoring case.
 * @param name - What was typed.
 * @param projects - The user's projects.
 * @param exceptId - The project being renamed, which may keep its own name; null for a new one.
 * @returns The reason, or null.
 */
export function projectNameProblem(name: string, projects: readonly Project[], exceptId: string | null): string | null {
  const clean = name.trim();
  if (clean === '') return SEGMENT_COPY.nameEmpty;
  if (clean.length > PROJECT_NAME_MAX) return tooManyCharacters(PROJECT_NAME_MAX);
  const lower = clean.toLowerCase();
  const isTaken = projects.some((p) => p.project_id !== exceptId && p.name.toLowerCase() === lower);
  return isTaken ? SEGMENT_COPY.nameTaken : null;
}

/**
 * The colour a new project starts with: the first one no project uses yet, else the first.
 * @param projects - The user's projects.
 * @returns The colour.
 */
export function nextProjectColor(projects: readonly Project[]): ProjectColor {
  return PROJECT_COLORS.find((color) => !projects.some((p) => p.color === color)) ?? 'orange';
}

/**
 * What a project holds: "3 clips · 2 recordings · 1 photo", each other kind only when there are
 * some; "0 clips" when it is empty.
 * @param project - The project.
 * @returns The words.
 */
export function projectCountsLine(project: Pick<Project, 'clip_count' | 'listen_count' | 'document_count' | 'photo_count'>): string {
  const others = [
    project.listen_count > 0 ? recordingCount(project.listen_count) : '',
    project.document_count > 0 ? docCount(project.document_count) : '',
    project.photo_count > 0 ? photoCount(project.photo_count) : '',
  ].filter((part) => part !== '');
  return [...(project.clip_count > 0 || others.length === 0 ? [clipCount(project.clip_count)] : []), ...others].join(' · ');
}

/**
 * Everything in a project (the sidebar's count).
 * @param project - The project.
 * @returns Clips, recordings, documents and photos together.
 */
export const projectItemCount = (project: Pick<Project, 'clip_count' | 'listen_count' | 'document_count' | 'photo_count'>): number =>
  project.clip_count + project.listen_count + project.document_count + project.photo_count;

/**
 * The segment header's line: "Segment · 3 clips · 2 recordings · 3.4 GB".
 * @param project - The project.
 * @returns The line.
 */
export const projectHeaderLine = (project: Project): string =>
  `${SEGMENT_COPY.segment} · ${projectCountsLine(project)} · ${formatBytes(project.size_bytes)}`;

/**
 * The New segment sheet's checkbox: "Add the 2 selected items".
 * @param count - Items selected (at least 1).
 * @returns The words.
 */
export const addSelectedLine = (count: number): string =>
  count === 1 ? 'Add the selected item' : `Add the ${String(count)} selected items`;

/**
 * Whether every given entry is in the project (the Add to segment submenu's check).
 * @param members - The project ids of each entry the menu acts on.
 * @param projectId - The project.
 * @returns True when there is at least one entry and all are in it.
 */
export const allInProject = (members: readonly (readonly string[])[], projectId: string): boolean =>
  members.length > 0 && members.every((ids) => ids.includes(projectId));

/**
 * "Shorts made" for a project: the shorts cut from at least one of its clips.
 * @param shorts - Every short's moments (`GET /shorts/{id}` segments, each with its clip).
 * @param clipIds - The project's clips.
 * @returns How many shorts use any of them.
 */
export function shortsUsingClips(shorts: readonly { segments: readonly { clip_id: string }[] }[], clipIds: readonly string[]): number {
  return shorts.filter((short) => short.segments.some((segment) => clipIds.includes(segment.clip_id))).length;
}

/** What "About this segment" lists. */
export interface ProjectFacts {
  clips: string;
  moments: string;
  faces: string;
  /** "40.4 MB of 3.4 GB". */
  onThisMac: string;
}

/**
 * The facts of "About this segment": "1 · 5:27", moments and faces summed over its clips, and
 * how much of it is on this Mac.
 * @param project - The project.
 * @param clips - Its clips.
 * @param cachedBytes - Bytes of its clips on this Mac.
 * @returns The facts.
 */
export function projectFacts(project: Project, clips: readonly ClipSummary[], cachedBytes: number): ProjectFacts {
  const moments = clips.reduce((sum, clip) => sum + clip.segment_count, 0);
  const faces = clips.reduce((sum, clip) => sum + clip.face_count, 0);
  return {
    clips: `${String(project.clip_count)} · ${formatDuration(project.duration_s)}`,
    moments: String(moments),
    faces: String(faces),
    onThisMac: `${formatBytes(cachedBytes)} of ${formatBytes(project.size_bytes)}`,
  };
}
