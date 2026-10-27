// The Mac app's page layout of redesign v2: the page's content beside a 320–360 px right column
// (the selected clip, a project's facts, a face). The shell drops its padding around it, so the
// page draws its own header (`mac-columns__head`). Each column scrolls on its own.
import type { ReactNode } from 'react';
import './MacColumns.css';

/** Props for `MacColumns`. */
export interface MacColumnsProps {
  /** The page's content (header, toolbar, grid). */
  children: ReactNode;
  /** The right column's content. */
  aside: ReactNode;
  /** The right column's accessible name ("Selected clip"). */
  asideLabel: string;
}

/**
 * The two page columns.
 * @param props - See `MacColumnsProps`.
 * @returns The layout.
 */
export function MacColumns({ children, aside, asideLabel }: MacColumnsProps) {
  return (
    <div className="mac-columns">
      <div className="mac-columns__main">{children}</div>
      <aside className="mac-columns__aside" aria-label={asideLabel}>
        {aside}
      </aside>
    </div>
  );
}
