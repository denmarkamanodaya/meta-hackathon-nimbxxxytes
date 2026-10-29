// iRead on the phone (`/iread`, V49): "iRead", the Features switch (iGuide | Shorts | iRead), one
// huge Snap a letter (the back camera), Choose a PDF, then "Your letters", one big row each (first
// page, title, "Sunvale Water · 24 Oct"). A new letter opens at once and is read while it shows.
import { Link, useNavigate } from 'react-router';
import { DocumentPicker } from '../components/DocumentPicker';
import { FeaturesSwitch } from '../components/FeaturesSwitch';
import { LoadError } from '../components/LoadError';
import { docMetaLine, docTitle, IREAD_COPY } from '../core/iread/documents';
import { EmptyState } from '../design/EmptyState';
import { Icon } from '../design/Icon';
import { PageHeader } from '../design/PageHeader';
import { Skeleton } from '../design/Skeleton';
import { Spinner } from '../design/Spinner';
import { documentPath, useAddDocument, useDocuments } from '../hooks/useDocuments';
import type { DocumentSummary } from '../services/api/types';
import './IReadPage.css';

function Row({ doc }: { doc: DocumentSummary }) {
  return (
    <li>
      <Link className="iread-page__row" to={documentPath(doc.id)}>
        <span className="iread-page__thumb">{doc.thumb_url !== null && <img src={doc.thumb_url} alt="" loading="lazy" />}</span>
        <span className="iread-page__text">
          <span className="iread-page__title">{docTitle(doc)}</span>
          <span className="iread-page__meta">{docMetaLine(doc, false)}</span>
        </span>
      </Link>
    </li>
  );
}

/**
 * The page.
 * @returns The iRead home.
 */
export function IReadPage() {
  const { state, refresh } = useDocuments();
  const { add, isAdding } = useAddDocument();
  const navigate = useNavigate();
  const open = (file: File) => {
    void add(file).then((id) => {
      if (id !== null) void navigate(documentPath(id));
    });
  };
  return (
    <div className="iread-page">
      <PageHeader title={IREAD_COPY.section} />
      <FeaturesSwitch view="iread" />
      <DocumentPicker pick="camera" className="iread-page__snap" isDisabled={isAdding} onFile={open}>
        {isAdding ? <Spinner /> : <Icon name="camera" size="lg" />}
        <span className="iread-page__snap-label">{isAdding ? IREAD_COPY.uploading : IREAD_COPY.snap}</span>
      </DocumentPicker>
      <DocumentPicker pick="pdf" className="iread-page__pdf" isDisabled={isAdding} onFile={open}>
        {IREAD_COPY.choosePdf}
      </DocumentPicker>
      <h2 className="iread-page__group">{IREAD_COPY.yourLetters}</h2>
      {state.status === 'loading' && (
        <div className="iread-page__list" aria-busy="true">
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
        <ul className="iread-page__list">
          {state.data.map((doc) => (
            <Row key={doc.id} doc={doc} />
          ))}
        </ul>
      )}
    </div>
  );
}
