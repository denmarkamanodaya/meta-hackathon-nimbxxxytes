// Card primitive: a raised surface that groups related content.
import type { ReactNode } from 'react';
import './Card.css';

/** Props for `Card`. */
export interface CardProps {
  /** Card content. */
  children: ReactNode;
}

/**
 * Raised surface with padding, radius and a soft shadow.
 * @param props - See `CardProps`.
 * @returns The card element.
 */
export function Card({ children }: CardProps) {
  return <div className="card">{children}</div>;
}
