// EmptyState primitive: the calm placeholder every page shows before it has data.
import type { ReactNode } from 'react';
import { Icon, type IconName } from './Icon';
import './EmptyState.css';

/** Props for `EmptyState`. */
export interface EmptyStateProps {
  /** Large icon above the title. */
  icon: IconName;
  /** One-line heading. */
  title: string;
  /** One or two sentences on what will appear here. */
  body: string;
  /** Optional call to action (a button or a button-styled link). */
  action?: ReactNode;
}

/**
 * Centred icon, title, explanation and optional action.
 * @param props - See `EmptyStateProps`.
 * @returns The empty-state block.
 */
export function EmptyState({ icon, title, body, action }: EmptyStateProps) {
  return (
    <section className="empty-state">
      <div className="empty-state__badge">
        <Icon name={icon} size="lg" />
      </div>
      <h2 className="empty-state__title">{title}</h2>
      <p className="empty-state__body">{body}</p>
      {action}
    </section>
  );
}
