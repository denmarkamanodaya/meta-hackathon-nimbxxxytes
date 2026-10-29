// iRead on the phone (`/iread`, V49), drawn with the iGuide list's rows (owner ruling 2026-10-29:
// iRead looks and sizes exactly like iGuide): "iRead", the Features switch (iGuide | Shorts |
// iRead), Snap a letter (the back camera), Choose a PDF, then "Your letters", one row each (first
// page, title, "Sunvale Water · 24 Oct" and the kind, or "Reading…" while Muse Spark reads it). A
// new letter opens at once and is read while it shows. An upload that never finished shows as
// Failed, "This upload didn't finish", with Try again and Delete under its row; a failed add says
// why under the buttons.
import { Link, useNavigate } from 'react-router';
import { DocumentPicker } from '../components/DocumentPicker';
import { FeaturesSwitch } from '../components/FeaturesSwitch';
import { LoadError } from '../components/LoadError';
import { StuckUploadActions } from '../components/StuckUploadActions';
import { docBadge, docMetaLine, docTitle, IREAD_COPY, isUploadStuck, shownDocument } from '../core/iread/documents';
import { buttonClassName } from '../design/Button';
import { Chip } from '../design/Chip';
import { EmptyState } from '../design/EmptyState';
import { Icon } from '../design/Icon';
import { PageHeader } from '../design/PageHeader';
import { Skeleton } from '../design/Skeleton';
import { Spinner } from '../design/Spinner';
import { documentPath, STUCK_TICK_MS, useAddDocument, useDocuments } from '../hooks/useDocuments';
import { useNow } from '../hooks/useNow';
import type { DocumentSummary } from '../services/api/types';
import './GuidesPage.css';
import './IReadPage.css';

function Row({ doc, nowMs, refresh }: { doc: DocumentSummary; nowMs: number; refresh: () => void }) {
  const navigate = useNavigate();
  const shown = shownDocument(doc, nowMs);
  const badge = docBadge(shown);
  return (
    <li>
      <Link className="guides-page__row" to={documentPath(doc.id)}>
        <span className="guides-page__thumb">{doc.thumb_url !== null && <img src={doc.thumb_url} alt="" loading="lazy" />}</span>
        <span className="guides-page__text">
          <span className="guides-page__title">{docTitle(shown)}</span>
          <span className="guides-page__meta">{docMetaLine(shown, false)}</span>
        </span>
        <Chip tone={badge.tone}>{badge.label}</Chip>
      </Link>
      {isUploadStuck(doc, nowMs) && (
        <div className="iread-page__stuck">
          <StuckUploadActions
            documentId={doc.id}
            onReplaced={(id) => {
              void navigate(documentPath(id));
            }}
            onDeleted={refresh}
            retryClassName={buttonClassName('primary', 'md')}
            deleteClassName={buttonClassName('secondary', 'md')}
            errorClassName="iread-page__error"
          />
        </div>
      )}
    </li>
  );
}

/**
 * The page.
 * @returns The iRead home.
 */
export function IReadPage() {
  const { state, refresh } = useDocuments();
  const { add, isAdding, error } = useAddDocument();
  const nowMs = useNow(STUCK_TICK_MS).getTime();
  const navigate = useNavigate();
  const open = (file: File) => {
    void add(file).then((id) => {
      if (id !== null) void navigate(documentPath(id));
    });
  };
  return (
    <div className="guides-page">
      <PageHeader title={IREAD_COPY.section} />
      <FeaturesSwitch view="iread" />
      <DocumentPicker pick="camera" className={buttonClassName('primary', 'lg')} isDisabled={isAdding} onFile={open}>
        {isAdding ? <Spinner /> : <Icon name="camera" size="md" />}
        {isAdding ? IREAD_COPY.uploading : IREAD_COPY.snap}
      </DocumentPicker>
      <DocumentPicker pick="pdf" className={buttonClassName('secondary', 'lg')} isDisabled={isAdding} onFile={open}>
        {IREAD_COPY.choosePdf}
      </DocumentPicker>
      {error !== null && (
        <p className="iread-page__error" role="alert">
          {`${IREAD_COPY.addFailed}: ${error}`}
        </p>
      )}
      <h2 className="iread-page__group">{IREAD_COPY.yourLetters}</h2>
      {state.status === 'loading' && (
        <div className="guides-page__list" aria-busy="true">
          <p className="visually-hidden" role="status">
            Loading your letters…
          </p>
          <Skeleton kind="line" />
          <Skeleton kind="line" />
        </div>
      )}
      {state.status === 'error' && <LoadError error={state.error} thing="letters" onRetry={refresh} />}
      {state.status === 'ready' && state.data.length === 0 && (
        <EmptyState icon="document" title={IREAD_COPY.emptyTitle} body={IREAD_COPY.emptyBodyPhone} />
      )}
      {state.status === 'ready' && state.data.length > 0 && (
        <ul className="guides-page__list">
          {state.data.map((doc) => (
            <Row key={doc.id} doc={doc} nowMs={nowMs} refresh={refresh} />
          ))}
        </ul>
      )}
    </div>
  );
}
