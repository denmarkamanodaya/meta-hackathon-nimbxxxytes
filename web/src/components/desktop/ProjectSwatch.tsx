// A project's colour square (redesign v2): 8 px in the sidebar and menus, 10 px in the project
// header. The colours are tokens; `projectColorClass` also names them for the menu's check items.
import type { ProjectColor } from '../../services/api/types';
import './ProjectSwatch.css';

/**
 * The class that fills an element with a project colour.
 * @param color - The colour.
 * @returns The class name.
 */
export const projectColorClass = (color: ProjectColor): string => `project-color--${color}`;

/**
 * The square; decorative, the project's name sits beside it.
 * @param props - The colour, and `large` for the header.
 * @returns The span.
 */
export function ProjectSwatch({ color, isLarge = false }: { color: ProjectColor; isLarge?: boolean }) {
  return <span className={`project-swatch${isLarge ? ' project-swatch--lg' : ''} ${projectColorClass(color)}`} aria-hidden="true" />;
}
