// Projects' rules on the client (redesign v2, Projects board): the name rule the API enforces
// (checked here first so the sheet can say why before sending), the colour names, the words of the
// project header and the New project sheet, and which colour a new project starts with.
import { PROJECT_COLORS, type ClipSummary, type Project, type ProjectColor } from '../services/api/types';
import { formatBytes, formatDuration } from './format';
import { clipCount } from './gallery';

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
  if (clean === '') return 'Give the project a name.';
  if (clean.length > PROJECT_NAME_MAX) return `Use ${String(PROJECT_NAME_MAX)} characters or fewer.`;
  const lower = clean.toLowerCase();
  const isTaken = projects.some((p) => p.project_id !== exceptId && p.name.toLowerCase() === lower);
  return isTaken ? 'You already have a project with this name.' : null;
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
 * The project header's line: "Project · 1 clip · 3.4 GB".
 * @param project - The project.
 * @returns The line.
 */
export const projectHeaderLine = (project: Project): string =>
  `Project · ${clipCount(project.clip_count)} · ${formatBytes(project.size_bytes)}`;

/**
 * The New project sheet's checkbox: "Add the 2 selected clips".
 * @param count - Clips selected (at least 1).
 * @returns The words.
 */
export const addSelectedLine = (count: number): string =>
  count === 1 ? 'Add the selected clip' : `Add the ${String(count)} selected clips`;

/**
 * Whether every given clip is in the project (the Add to project submenu's check).
 * @param clips - The clips the menu acts on.
 * @param projectId - The project.
 * @returns True when there is at least one clip and all are in it.
 */
export const allInProject = (clips: readonly ClipSummary[], projectId: string): boolean =>
  clips.length > 0 && clips.every((clip) => clip.project_ids.includes(projectId));

/**
 * "Shorts made" for a project: the shorts cut from at least one of its clips.
 * @param shorts - Every short's moments (`GET /shorts/{id}` segments, each with its clip).
 * @param clipIds - The project's clips.
 * @returns How many shorts use any of them.
 */
export function shortsUsingClips(shorts: readonly { segments: readonly { clip_id: string }[] }[], clipIds: readonly string[]): number {
  return shorts.filter((short) => short.segments.some((segment) => clipIds.includes(segment.clip_id))).length;
}

/** What "About this project" lists. */
export interface ProjectFacts {
  clips: string;
  moments: string;
  faces: string;
  /** "40.4 MB of 3.4 GB". */
  onThisMac: string;
}

/**
 * The facts of "About this project": "1 · 5:27", moments and faces summed over its clips, and
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
