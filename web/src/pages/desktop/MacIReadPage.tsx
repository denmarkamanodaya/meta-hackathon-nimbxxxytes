// iRead on the Mac (V46): "iRead" with how many documents; one row per letter (its first page, the
// title, "Sunvale Water · 24 Oct · 1 page" and the kind pill). A click selects a row for the right
// column: the page, the title and line, the summary in large type, Read it to me, Ask about it…
// (the letter goes into the Ask box) and Show the page (opens the letter). A double click or ⏎
// opens it; a right-click on a read letter opens Rename… / Delete letter…. With no letters, an
// empty state uploads a photo or PDF.
import { useState, type MouseEvent } from 'react';
import { Link, useNavigate } from 'react-router';
import { DocumentPicker } from '../../components/DocumentPicker';
import { LoadError } from '../../components/LoadError';
import { ReadToMeButton } from '../../components/ReadToMeButton';
import { MacColumns } from '../../components/desktop/MacColumns';
import { documentMenuItems, MacDocumentDialogs, type DocumentAsk } from '../../components/desktop/MacDocumentOptions';
import { useAskAboutDocument } from '../../components/desktop/MacSearchBar';
import { docKindLabel, docMetaLine, docTitle, documentCount, IREAD_COPY, isDocBusy } from '../../core/iread/documents';
import { EmptyState } from '../../design/EmptyState';
import { Menu } from '../../design/Menu';
import { Skeleton } from '../../design/Skeleton';
import { Spinner } from '../../design/Spinner';
import { documentPath, useAddDocument, useDocument, useDocuments } from '../../hooks/useDocuments';
import { useMenu } from '../../hooks/useMenu';
import { useReadAloud } from '../../hooks/useReadAloud';
import type { DocumentSummary } from '../../services/api/types';
import './MacIReadPage.css';

interface RowProps {
  doc: DocumentSummary;
  isSelected: boolean;
  onSelect: () => void;
  onAsk: (ask: DocumentAsk) => void;
}

function Row({ doc, isSelected, onSelect, onAsk }: RowProps) {
  const navigate = useNavigate();
  const menu = useMenu();
  const title = docTitle(doc);
  const onContextMenu = (event: MouseEvent<HTMLElement>) => {
    // A letter still being read has no actions yet, but the webview's own menu stays away.
    if (isDocBusy(doc.status)) event.preventDefault();
    else menu.openAtPointer(event);
  };
  return (
    <li onContextMenu={onContextMenu}>
      <button
        type="button"
        className={isSelected ? 'mac-iread__row mac-iread__row--on' : 'mac-iread__row'}
        aria-pressed={isSelected}
        onClick={onSelect}
        onDoubleClick={() => {
          void navigate(documentPath(doc.id));
        }}
        onKeyDown={(event) => {
          if (event.key !== 'Enter') return;
          event.preventDefault();
          void navigate(documentPath(doc.id));
        }}
      >
        <span className="mac-iread__thumb">{doc.thumb_url !== null && <img src={doc.thumb_url} alt="" loading="lazy" />}</span>
        <span className="mac-iread__text">
          <span className="mac-iread__title">{title}</span>
          <span className="mac-iread__meta">{docMetaLine(doc, true)}</span>
        </span>
        {doc.status === 'ready' && <span className="mac-iread__kind">{docKindLabel(doc.kind)}</span>}
        {isDocBusy(doc.status) && <Spinner />}
      </button>
      <Menu anchor={menu.anchor} label={title} onClose={menu.close} className="mac-menu--narrow" items={documentMenuItems({ documentId: doc.id, title }, onAsk)} />
    </li>
  );
}

/** The right column for the selected letter, read in full (its page and summary). */
function Selected({ summary }: { summary: DocumentSummary }) {
  const { state } = useDocument(summary.id);
  const player = useReadAloud();
  const askAbout = useAskAboutDocument();
  const doc = state.status === 'ready' ? state.data : null;
  const page = doc?.pages[0]?.image_url ?? summary.thumb_url;
  const status = doc?.status ?? summary.status;
  return (
    <div className="mac-iread__aside">
      <Link to={documentPath(summary.id)} className="mac-iread__page" aria-label={IREAD_COPY.showPage}>
        {page !== null && <img src={page} alt="" />}
      </Link>
      <span className="mac-iread__pv-title">{docTitle(doc ?? summary)}</span>
      <span className="mac-iread__pv-meta">{docMetaLine(doc ?? summary, true)}</span>
      {status === 'ready' && doc !== null && (
        <>
          <p className="mac-iread__summary">{doc.summary}</p>
          <ReadToMeButton doc={doc} player={player} className="mac-iread__read" messageClassName="mac-iread__pv-meta" />
          <span className="mac-iread__buttons">
            {askAbout !== null && (
              <button
                type="button"
                className="mac-button mac-iread__button"
                onClick={() => {
                  askAbout(doc.id);
                }}
              >
                {IREAD_COPY.askAbout}
              </button>
            )}
            <Link to={documentPath(doc.id)} className="mac-button mac-iread__button">
              {IREAD_COPY.showPage}
            </Link>
          </span>
        </>
      )}
      {isDocBusy(status) && <span className="mac-iread__pv-meta">{IREAD_COPY.readingLine}</span>}
    </div>
  );
}

/**
 * The page (`/iread` in the Mac app).
 * @returns The page.
 */
export function MacIReadPage() {
  const { state, refresh } = useDocuments();
  const { add, isAdding } = useAddDocument();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [ask, setAsk] = useState<DocumentAsk>(null);
  const rows = state.status === 'ready' ? state.data : [];
  const selected = rows.find((row) => row.id === selectedId) ?? rows[0];
  const upload = (
    <DocumentPicker
      pick="any"
      className="mac-button mac-button--primary"
      isDisabled={isAdding}
      onFile={(file) => {
        void add(file).then((id) => {
          if (id === null) return;
          refresh();
          setSelectedId(id);
        });
      }}
    >
      {isAdding ? IREAD_COPY.uploading : IREAD_COPY.uploadDocument}
    </DocumentPicker>
  );
  return (
    <MacColumns asideLabel="Selected letter" aside={selected === undefined ? undefined : <Selected key={selected.id} summary={selected} />}>
      <header className="mac-columns__head">
        <h1 className="mac-columns__title">{IREAD_COPY.section}</h1>
        {state.status === 'ready' && rows.length > 0 && <span className="mac-columns__sub">{documentCount(rows.length)}</span>}
      </header>
      {state.status === 'loading' && (
        <div className="mac-iread__list" aria-busy="true">
          <p className="visually-hidden" role="status">
            Loading your letters…
          </p>
          <Skeleton kind="line" />
          <Skeleton kind="line" />
        </div>
      )}
      {state.status === 'error' && <LoadError error={state.error} thing="letters" onRetry={refresh} />}
      {state.status === 'ready' && rows.length === 0 && (
        <EmptyState icon="document" title={IREAD_COPY.emptyTitle} body={IREAD_COPY.emptyBodyMac} action={upload} />
      )}
      {rows.length > 0 && (
        <ul className="mac-iread__list">
          {rows.map((doc) => (
            <Row
              key={doc.id}
              doc={doc}
              isSelected={doc.id === selected?.id}
              onSelect={() => {
                setSelectedId(doc.id);
              }}
              onAsk={setAsk}
            />
          ))}
        </ul>
      )}
      <MacDocumentDialogs
        ask={ask}
        onClose={() => {
          setAsk(null);
        }}
        onRenamed={refresh}
        onDeleted={refresh}
      />
    </MacColumns>
  );
}
