// The round 44 px ⋯ button that opens an actions menu (mock V4). `overlay` sits on media (the
// clip player), `surface` on cards and page headers.
import type { MouseEvent } from 'react';
import './MoreButton.css';

/** Props for `MoreButton`. */
export interface MoreButtonProps {
  /** Look: on media or on a light surface. */
  tone: 'overlay' | 'surface';
  /** Whether its menu is open (`aria-expanded`). */
  isOpen: boolean;
  onClick: (event: MouseEvent<HTMLButtonElement>) => void;
}

/**
 * The button.
 * @param props - See `MoreButtonProps`.
 * @returns The button, labelled "More actions".
 */
export function MoreButton({ tone, isOpen, onClick }: MoreButtonProps) {
  return (
    <button
      type="button"
      className={`more-button more-button--${tone}`}
      aria-label="More actions"
      aria-haspopup="menu"
      aria-expanded={isOpen}
      onClick={onClick}
    >
      <span className="more-button__dot" />
      <span className="more-button__dot" />
      <span className="more-button__dot" />
    </button>
  );
}
