// Section primitive: a titled block on a detail page.
import type { ReactNode } from 'react';
import './Section.css';

/** Props for `Section`. */
export interface SectionProps {
  /** Heading (rendered as h2). */
  title: string;
  /** Optional count shown after the title. */
  count?: number;
  children: ReactNode;
}

/**
 * Heading plus content, spaced on the page rhythm.
 * @param props - See `SectionProps`.
 * @returns The section element.
 */
export function Section({ title, count, children }: SectionProps) {
  return (
    <section className="section">
      <h2 className="section__title">
        {title}
        {count !== undefined && <span className="section__count">{count}</span>}
      </h2>
      {children}
    </section>
  );
}
