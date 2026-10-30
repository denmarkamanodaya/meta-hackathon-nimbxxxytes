// The Add to segment list (redesign v2; projects are shown as segments): every project as a check
// item with its colour, checked when all the entries it acts on are in it, then "New segment…".
// Shared by the right-click menus, the Select bar and the right column's Add to segment button.
import { SEGMENT_COPY } from '../../core/copy';
import { itemProjectIds, type GalleryItem } from '../../core/gallery-items';
import { allInProject } from '../../core/projects';
import type { MenuEntry } from '../../design/Menu';
import type { Project } from '../../services/api/types';
import { projectColorClass } from './ProjectSwatch';

/**
 * The entries.
 * @param projects - Every project.
 * @param entries - The clips, recordings, documents and photos the menu acts on.
 * @param toggle - Puts the entries in a project, or takes them out when all are in it.
 * @param onNew - Opens the New segment sheet.
 * @returns The menu entries.
 */
export function addToProjectItems(
  projects: readonly Project[],
  entries: readonly GalleryItem[],
  toggle: (projectId: string, entries: readonly GalleryItem[]) => Promise<boolean>,
  onNew: () => void,
): MenuEntry[] {
  const members = entries.map(itemProjectIds);
  const checks: MenuEntry[] = projects.map((project) => ({
    kind: 'check',
    label: project.name,
    isChecked: allInProject(members, project.project_id),
    swatchClass: projectColorClass(project.color),
    onSelect: () => {
      void toggle(project.project_id, entries);
    },
  }));
  return [...checks, ...(checks.length > 0 ? [{ kind: 'separator' } as const] : []), { kind: 'item', label: SEGMENT_COPY.newSegmentMenu, icon: 'plus', onSelect: onNew }];
}
