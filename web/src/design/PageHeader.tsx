// PageHeader primitive: large page title with an optional eyebrow and trailing slot.
import type { ReactNode } from 'react';
import './PageHeader.css';

/** Props for `PageHeader`. */
export interface PageHeaderProps {
  /** Page title (rendered as the page's h1). */
  title: string;
  /** Small line above the title, such as the brand or a back link. */
  eyebrow?: ReactNode;
  /** Content aligned to the right of the title, such as a status chip. */
  trailing?: ReactNode;
}

/**
 * Page title block that clears the status bar (safe-area top inset).
 * @param props - See `PageHeaderProps`.
 * @returns The header element.
 */
export function PageHeader({ title, eyebrow, trailing }: PageHeaderProps) {
  return (
    <header className="page-header">
      {eyebrow !== undefined && <div className="page-header__eyebrow">{eyebrow}</div>}
      <div className="page-header__row">
        <h1 className="page-header__title">{title}</h1>
        {trailing}
      </div>
    </header>
  );
}
