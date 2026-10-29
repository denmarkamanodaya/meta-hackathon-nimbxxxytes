// iRead on the Mac (V46), drawn with the iGuide list's rows and right column (owner ruling
// 2026-10-29: iRead looks and sizes exactly like iGuide): "iRead" with how many documents; one row
// per letter (its first page, the title, "Sunvale Water · 24 Oct · 1 page" and the kind pill, or
// "Reading…" while Muse Spark reads it). A click selects a row for the right column: the title and
// line, the page, the summary, Read it to me, Ask about it… (the letter goes into the Ask box) and
// Show the page (opens the letter), then when it was added. A double click or ⏎ opens it; a
// right-click on a read letter opens Rename… / Delete letter…. With no letters, an empty state
// uploads a photo or PDF.
import { useState, type MouseEvent } from 'react';
import { Link, useNavigate } from 'react-router';
import { DocumentPicker } from '../../components/DocumentPicker';
import { StageList } from '../../components/GuideStages';
import { LoadError } from '../../components/LoadError';
import { ReadToMeButton } from '../../components/ReadToMeButton';
import { ClipPanel } from '../../components/desktop/ClipPanel';
import { MacColumns, MacPill } from '../../components/desktop/MacColumns';
import { documentMenuItems, MacDocumentDialogs, type DocumentAsk } from '../../components/desktop/MacDocumentOptions';
import { useAskAboutDocument } from '../../components/desktop/MacSearchBar';
import { formatShortDate } from '../../core/format';
import { docBadge, docMetaLine, docStageRows, docTitle, documentCount, IREAD_COPY, isDocBusy } from '../../core/iread/documents';
import { EmptyState } from '../../design/EmptyState';
import { Icon } from '../../design/Icon';
import { Menu } from '../../design/Menu';
import { Skeleton } from '../../design/Skeleton';
import { documentPath, useAddDocument, useDocument, useDocuments } from '../../hooks/useDocuments';
import { useMenu } from '../../hooks/useMenu';
import { useReadAloud } from '../../hooks/useReadAloud';
import type { DocumentSummary } from '../../services/api/types';
import './MacGuidesPage.css';
import './MacGuidePage.css';
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
  const badge = docBadge(doc);
  const onContextMenu = (event: MouseEvent<HTMLElement>) => {
    // A letter still being read has no actions yet, but the webview's own menu stays away.
    if (isDocBusy(doc.status)) event.preventDefault();
    else menu.openAtPointer(event);
  };
  return (
    <li onContextMenu={onContextMenu}>
      <button
        type="button"
        className={isSelected ? 'mac-guides__row mac-guides__row--on' : 'mac-guides__row'}
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
        <span className="mac-guides__thumb">{doc.thumb_url !== null && <img src={doc.thumb_url} alt="" loading="lazy" />}</span>
        <span className="mac-guides__text">
          <span className="mac-guides__title">{title}</span>
          <span className="mac-guides__meta">{docMetaLine(doc, true)}</span>
        </span>
        <MacPill tone={badge.tone}>{badge.label}</MacPill>
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
    <ClipPanel>
      <div className="mac-guides__aside">
        <h2 className="mac-guides__pv-title">{docTitle(doc ?? summary)}</h2>
        <span className="mac-guides__muted">{docMetaLine(doc ?? summary, true)}</span>
        {page !== null && (
          <Link to={documentPath(summary.id)} className="mac-guides__preview mac-iread__page" aria-label={IREAD_COPY.showPage}>
            <img src={page} alt="" />
          </Link>
        )}
        {isDocBusy(status) && (
          <>
            <span className="mac-guides__muted">{IREAD_COPY.readingLine}</span>
            <StageList rows={docStageRows(status)} />
          </>
        )}
        {status === 'failed' && <span className="mac-guides__muted">{doc?.error ?? summary.error ?? IREAD_COPY.failedTitle}</span>}
        {status === 'ready' && doc !== null && (
          <>
            <span className="mac-guides__pv-text">{doc.summary}</span>
            <span className="mac-guides__buttons">
              <ReadToMeButton doc={doc} player={player} className="mac-button mac-button--primary mac-guide__button" messageClassName="mac-guides__muted" />
              {askAbout !== null && (
                <button
                  type="button"
                  className="mac-button"
                  onClick={() => {
                    askAbout(doc.id);
                  }}
                >
                  {IREAD_COPY.askAbout}
                </button>
              )}
              <Link to={documentPath(doc.id)} className="mac-button">
                {IREAD_COPY.showPage}
              </Link>
            </span>
          </>
        )}
        <span className="mac-guides__muted">{`Made ${formatShortDate(summary.created_at, new Date())}`}</span>
      </div>
    </ClipPanel>
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
      <Icon name="plus" size="xs" />
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
        <div className="mac-guides__list" aria-busy="true">
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
        <ul className="mac-guides__list">
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
