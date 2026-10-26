// Clip detail page: player, segments and people for one clip. Phase 0 shows the empty state only.
import { Link, useParams } from 'react-router';
import { EmptyState } from '../design/EmptyState';
import { Icon } from '../design/Icon';
import { PageHeader } from '../design/PageHeader';
import './ClipDetailPage.css';

/**
 * Shows one clip by its route id.
 * @returns The page.
 */
export function ClipDetailPage() {
  const { id = '' } = useParams();

  return (
    <>
      <PageHeader
        eyebrow={
          <Link to="/" className="clip-detail-page__back">
            <Icon name="back" />
            Library
          </Link>
        }
        title="Clip"
      />
      <EmptyState
        icon="sparkle"
        title="Nothing here yet"
        body={`Clip ${id} has no scenes yet. They appear here once it is processed.`}
      />
    </>
  );
}
