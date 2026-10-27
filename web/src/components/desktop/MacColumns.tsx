// The Mac app's page layout of redesign v2: the page's content beside a 320–360 px right column
// (the selected clip, a project's facts, a face), or alone (the Productions list). The shell drops
// its padding around it, so the page draws its own header (`mac-columns__head`). Each column
// scrolls on its own. Also the pieces those headers and rows share: the "‹ Gallery /" crumb, the
// small status pills and the slim coverage bar.
import type { ReactNode } from 'react';
import { Link } from 'react-router';
import { Icon } from '../../design/Icon';
import './MacColumns.css';

/** Props for `MacColumns`. */
export interface MacColumnsProps {
  /** The page's content (header, toolbar, grid). */
  children: ReactNode;
  /** The right column's content; left out, the page has no right column. */
  aside?: ReactNode;
  /** The right column's accessible name ("Selected clip"). */
  asideLabel?: string;
}

/**
 * The page columns.
 * @param props - See `MacColumnsProps`.
 * @returns The layout.
 */
export function MacColumns({ children, aside, asideLabel }: MacColumnsProps) {
  return (
    <div className="mac-columns">
      <div className="mac-columns__main">{children}</div>
      {aside !== undefined && (
        <aside className="mac-columns__aside" aria-label={asideLabel}>
          {aside}
        </aside>
      )}
    </div>
  );
}

/**
 * The header's way back: "‹ Gallery" and the slash before the page's title.
 * @param props - Where it goes and its name.
 * @returns The link and the slash.
 */
export function MacCrumb({ to, label }: { to: string; label: string }) {
  return (
    <>
      <Link className="mac-columns__back" to={to}>
        <Icon name="back" size="xs" />
        {label}
      </Link>
      <span className="mac-columns__slash" aria-hidden="true">
        /
      </span>
    </>
  );
}

/** A pill's colour role. */
export type MacPillTone = 'neutral' | 'accent' | 'success' | 'warning' | 'danger';

/**
 * A small status pill ("Covered", "Proxy", "Story · 60 s").
 * @param props - Its text, colour role and size (`sm` is the Productions list's 18 px).
 * @returns The pill.
 */
export function MacPill({ children, tone = 'neutral', isSmall = false }: { children: ReactNode; tone?: MacPillTone; isSmall?: boolean }) {
  return <span className={`mac-pill mac-pill--${tone}${isSmall ? ' mac-pill--sm' : ''}`}>{children}</span>;
}

/**
 * The slim coverage bar.
 * @param props - Filled share 0–100 and its accessible name.
 * @returns The bar.
 */
export function MacMeter({ percent, label }: { percent: number; label: string }) {
  return (
    <span className="mac-meter" role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent}>
      <span className="mac-meter__fill" style={{ width: `${String(percent)}%` }} />
    </span>
  );
}
