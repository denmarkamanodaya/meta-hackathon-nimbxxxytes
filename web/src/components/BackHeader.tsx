// Header of a full-screen page (a short, a production, finishing, publishing): a round Back
// button, the page's title and a muted line under it, and an optional trailing slot.
import type { ReactNode } from 'react';
import { useLocation, useNavigate } from 'react-router';
import { Icon } from '../design/Icon';
import './BackHeader.css';

/** Props for `BackHeader`. */
export interface BackHeaderProps {
  title: string;
  subtitle: string;
  /** Where Back goes when the page was opened directly (no history to go back to). */
  fallback: string;
  /** Content to the right, such as the ⋯ menu. */
  actions?: ReactNode;
}

/**
 * The header.
 * @param props - See `BackHeaderProps`.
 * @returns The header element.
 */
export function BackHeader({ title, subtitle, fallback, actions }: BackHeaderProps) {
  const navigate = useNavigate();
  const location = useLocation();
  return (
    <header className="back-header">
      <button
        type="button"
        className="back-header__back"
        aria-label="Back"
        onClick={() => {
          if (location.key === 'default') void navigate(fallback);
          else void navigate(-1);
        }}
      >
        <Icon name="back" size="md" />
      </button>
      <div className="back-header__heading">
        <h1 className="back-header__title">{title}</h1>
        <span className="back-header__subtitle">{subtitle}</span>
      </div>
      {actions}
    </header>
  );
}
