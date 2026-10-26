// Editor page: the agentic short editor. Receives the moments picked on Search.
import { Link, useLocation } from 'react-router';
import { readEditorHandoff } from '../core/selection';
import { buttonClassName } from '../design/Button';
import { Card } from '../design/Card';
import { EmptyState } from '../design/EmptyState';
import { Icon } from '../design/Icon';
import { PageHeader } from '../design/PageHeader';
import './EditorPage.css';

/**
 * Entry to the editor; with no picked moments it points to Search.
 * @returns The page.
 */
export function EditorPage() {
  const segmentIds = readEditorHandoff(useLocation().state);

  return (
    <>
      <PageHeader title="Editor" />
      {segmentIds.length === 0 ? (
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
      ) : (
        <Card>
          <div className="editor-page__picked">
            <span className="editor-page__count">{segmentIds.length}</span>
            <div>
              <p className="editor-page__title">
                {segmentIds.length === 1 ? 'moment picked' : 'moments picked'}
              </p>
              <Link to="/search" className="editor-page__change">
                Change selection
              </Link>
            </div>
          </div>
        </Card>
      )}
    </>
  );
}
