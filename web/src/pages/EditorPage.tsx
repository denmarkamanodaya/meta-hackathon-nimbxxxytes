// Editor page: the agentic short editor. Phase 0 shows the empty state only.
import { Link } from 'react-router';
import { buttonClassName } from '../design/Button';
import { EmptyState } from '../design/EmptyState';
import { Icon } from '../design/Icon';
import { PageHeader } from '../design/PageHeader';

/**
 * Entry to the editor; points the user to search to pick moments first.
 * @returns The page.
 */
export function EditorPage() {
  return (
    <>
      <PageHeader title="Editor" />
      <EmptyState
        icon="editor"
        title="Make a short"
        body="Pick moments, say what you want to post, and the editor cuts, captions and critiques a draft for you."
        action={
          <Link to="/search" className={buttonClassName('primary')}>
            <Icon name="search" />
            Find moments
          </Link>
        }
      />
    </>
  );
}
