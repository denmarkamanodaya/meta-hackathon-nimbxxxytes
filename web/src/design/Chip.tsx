// Chip primitive: a compact pill for suggestions, filters and status.
import type { ReactNode } from 'react';
import './Chip.css';

/** Props for `Chip`. */
export interface ChipProps {
  /** Chip text (and optional leading icon). */
  children: ReactNode;
  /** Makes the chip a button; omit for a static label. */
  onClick?: () => void;
  /** Colour role of a static chip; defaults to `neutral`. */
  tone?: 'neutral' | 'accent' | 'success' | 'warning' | 'danger';
}

/**
 * Pill label. With `onClick` it renders a 44 px tall button; without, a static span.
 * @param props - See `ChipProps`.
 * @returns The chip element.
 */
export function Chip({ children, onClick, tone = 'neutral' }: ChipProps) {
  const className = `chip chip--${tone}`;
  if (onClick === undefined) return <span className={className}>{children}</span>;
  return (
    <button type="button" className={`${className} chip--action`} onClick={onClick}>
      {children}
    </button>
  );
}
