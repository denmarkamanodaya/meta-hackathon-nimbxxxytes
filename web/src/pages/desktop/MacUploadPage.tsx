// Upload in the Mac app: "Choose clips…" opens the native file dialog (mp4, mov, m4v) and the
// app's own upload engine sends them (no browser upload from the app window); progress comes from
// the sync status transfers going up, drawn like the Sync page's Transfers (mock M3).
import { transferRow } from '../../core/desktop-sync';
import { TransferList } from '../../components/desktop/TransferList';
import { StorageNotice } from '../../components/StorageNotice';
import { Button } from '../../design/Button';
import { Spinner } from '../../design/Spinner';
import { usePickAndUpload, useSyncStatus } from '../../hooks/useDesktop';
import { useStorageCap } from '../../hooks/useOverview';
import './MacUploadPage.css';

/**
 * The page.
 * @returns The page.
 */
export function MacUploadPage() {
  const { pick, isPicking } = usePickAndUpload();
  const { state } = useSyncStatus();
  const cap = useStorageCap();
  const rows =
    state.status === 'ready' ? state.data.transfers.filter((t) => t.direction === 'up').map(transferRow) : [];
  return (
    <div className="mac-upload">
      <div className="mac-upload__header">
        <div className="mac-upload__heading">
          <h1 className="mac-upload__title">Upload</h1>
          <span className="mac-upload__muted">Straight to your private cloud. Large files go up in parts and resume.</span>
        </div>
        <Button
          disabled={isPicking || cap?.isFull === true}
          onClick={() => {
            void pick();
          }}
        >
          {isPicking && <Spinner />}
          Choose clips…
        </Button>
      </div>
      <StorageNotice cap={cap} />
      <section className="mac-upload__card" aria-label="Uploads">
        <h2 className="mac-upload__h2">Uploads</h2>
        <TransferList rows={rows} empty="Nothing uploading. Choose clips, or drop finished edits in ~/nimbytes/Exports." />
      </section>
    </div>
  );
}
