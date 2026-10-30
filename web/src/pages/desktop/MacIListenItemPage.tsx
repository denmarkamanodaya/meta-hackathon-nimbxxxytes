// A recording on the Mac (`/ilisten/:id`, mock frames 1 and 2): "‹ iListen / title" and ⋯ (Rename…,
// Delete recording…), then the recording in one readable column: Heard, Checked, the summary with
// its language select, Read it to me, Ask about it… and What was said; while it works, the progress
// list with the check loop.
import { useParams } from 'react-router';
import { LoadError } from '../../components/LoadError';
import { MacColumns, MacCrumb } from '../../components/desktop/MacColumns';
import { MacListenDetail } from '../../components/desktop/MacListenDetail';
import { MacListenOptions } from '../../components/desktop/MacListenOptions';
import { ILISTEN_COPY, isListenBusy, listenTitle } from '../../core/ilisten/listens';
import { Skeleton } from '../../design/Skeleton';
import { ILISTEN_PATH, useListen } from '../../hooks/useListens';
import './MacGuidePage.css';
import './MacIListenItemPage.css';

/**
 * The page (`/ilisten/:id` in the Mac app).
 * @returns The page.
 */
export function MacIListenItemPage() {
  const { id = '' } = useParams();
  const { state, refresh } = useListen(id);
  const listen = state.status === 'ready' ? state.data : null;
  return (
    <MacColumns>
      <header className="mac-columns__head mac-columns__head--crumb">
        <MacCrumb to={ILISTEN_PATH} label={ILISTEN_COPY.section} />
        <h1 className="mac-columns__crumb-title mac-guide__head-title">{listen === null ? '' : listenTitle(listen)}</h1>
        {listen !== null && !isListenBusy(listen.status) && <MacListenOptions listen={{ listenId: listen.id, title: listenTitle(listen) }} onRenamed={refresh} />}
      </header>
      {state.status === 'loading' && (
        <div className="mac-guide__state" aria-busy="true">
          <p className="visually-hidden" role="status">
            Loading the recording…
          </p>
          <Skeleton kind="line" />
        </div>
      )}
      {state.status === 'error' && <LoadError error={state.error} thing="recording" onRetry={refresh} />}
      {listen !== null && (
        <div className="mac-listen-page">
          <MacListenDetail listen={listen} refresh={refresh} withTitle={false} />
        </div>
      )}
    </MacColumns>
  );
}
