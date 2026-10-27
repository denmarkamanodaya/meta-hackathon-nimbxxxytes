// The Add to project list (redesign v2): every project as a check item with its colour, checked
// when all the clips it acts on are in it, then "New project…". Shared by the right-click menu's
// submenu and the right column's Add to project button.
import { allInProject } from '../../core/projects';
import type { MenuEntry } from '../../design/Menu';
import type { ClipSummary, Project } from '../../services/api/types';
import { projectColorClass } from './ProjectSwatch';

/**
 * The entries.
 * @param projects - Every project.
 * @param clips - The clips the menu acts on.
 * @param toggle - Puts the clips in a project, or takes them out when all are in it.
 * @param onNew - Opens the New project sheet.
 * @returns The menu entries.
 */
export function addToProjectItems(
  projects: readonly Project[],
  clips: readonly ClipSummary[],
  toggle: (projectId: string, clips: readonly ClipSummary[]) => Promise<boolean>,
  onNew: () => void,
): MenuEntry[] {
  const checks: MenuEntry[] = projects.map((project) => ({
    kind: 'check',
    label: project.name,
    isChecked: allInProject(clips, project.project_id),
    swatchClass: projectColorClass(project.color),
    onSelect: () => {
      void toggle(project.project_id, clips);
    },
  }));
  return [...checks, ...(checks.length > 0 ? [{ kind: 'separator' } as const] : []), { kind: 'item', label: 'New project…', icon: 'plus', onSelect: onNew }];
}
