// Library page: the user's clips with live status (polls GET /clips every 3 s).
import { Link } from 'react-router';
import { ClipRow } from '../components/ClipRow';
import { HealthChip } from '../components/HealthChip';
import { buttonClassName } from '../design/Button';
import { Chip } from '../design/Chip';
import { EmptyState } from '../design/EmptyState';
import { Icon } from '../design/Icon';
import { PageHeader } from '../design/PageHeader';
import { useClips, type ClipsState } from '../hooks/useClips';
import './LibraryPage.css';

const uploadLink = (
  <Link to="/upload" className={buttonClassName('primary')}>
    <Icon name="upload" />
    Upload clips
  </Link>
);

function LibraryBody({ state }: { state: ClipsState }) {
  if (state.status === 'loading') {
    return <p className="library-page__note" role="status">Loading your clips…</p>;
  }
  if (state.status === 'error') {
    return <EmptyState icon="cloud" title="Could not load your clips" body={state.message} />;
  }
  if (state.clips.length === 0) {
    return (
      <EmptyState
        icon="cloud"
        title="Your library is empty"
        body="Upload clips from your glasses. nimbytes watches every scene so you can find any moment later."
        action={uploadLink}
      />
    );
  }
  return (
    <>
      {state.stale && (
        <div className="library-page__stale" role="status">
          <Chip tone="danger">Offline</Chip>
          <span className="library-page__note">Showing your last loaded list.</span>
        </div>
      )}
      <ul className="library-page__list">
        {state.clips.map((clip) => (
          <ClipRow key={clip.clip_id} clip={clip} />
        ))}
      </ul>
    </>
  );
}

/**
 * Lists the user's clips; until the first upload, explains what the library does.
 * @returns The page.
 */
export function LibraryPage() {
  const state = useClips();
  return (
    <>
      <PageHeader
        eyebrow={
          <>
            <Icon name="cloud" />
            nimbytes
          </>
        }
        title="Library"
        trailing={<HealthChip />}
      />
      <LibraryBody state={state} />
    </>
  );
}
