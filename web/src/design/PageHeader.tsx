// PageHeader primitive: the Mist page title (display face), an optional line under it, and a
// trailing slot.
import type { ReactNode } from 'react';
import './PageHeader.css';

/** Props for `PageHeader`. */
export interface PageHeaderProps {
  /** Page title (rendered as the page's h1). */
  title: string;
  /** One line under the title. */
  subtitle?: string;
  /** Content above the title, such as a back link. */
  eyebrow?: ReactNode;
  /** Content aligned to the right of the title. */
  trailing?: ReactNode;
}

/**
 * Page title block that clears the status bar (safe-area top inset).
 * @param props - See `PageHeaderProps`.
 * @returns The header element.
 */
export function PageHeader({ title, subtitle, eyebrow, trailing }: PageHeaderProps) {
  return (
    <header className="page-header">
      {eyebrow !== undefined && <div className="page-header__eyebrow">{eyebrow}</div>}
      <div className="page-header__row">
        <div className="page-header__text">
          <h1 className="page-header__title">{title}</h1>
          {subtitle !== undefined && <p className="page-header__subtitle">{subtitle}</p>}
        </div>
        {trailing}
      </div>
    </header>
  );
}
