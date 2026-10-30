// The Gallery's right column for a recording or a document (mock GalleryMixedMock). A recording:
// its player (a tapped line plays from there, the line playing now is lit), the title, "1:30 · 中文
// 45% · 日本語 55% → English", the summary with its check pill, What was said, then Open in iListen,
// Read it to me and ⋯ (Rename…, Delete recording…); while it is listened to, its progress. A
// document: its first page, the title, "Sunvale Water · 24 Oct · 1 page", the summary, then Open in
// iRead, Read it to me and ⋯ (Rename…, Delete letter…). Deleting from here keeps the Gallery open.
import { useState, type MouseEvent } from 'react';
import { Link } from 'react-router';
import { documentItemId, recordingItemId } from '../../core/gallery-items';
import { docMetaLine, docTitle, IREAD_COPY, isDocBusy } from '../../core/iread/documents';
import { ILISTEN_COPY, isListenBusy, listenPanelLine, listenPill, listenTitle } from '../../core/ilisten/listens';
import { Icon } from '../../design/Icon';
import { Menu } from '../../design/Menu';
import { Skeleton } from '../../design/Skeleton';
import { useAudioPlayer } from '../../hooks/useAudioPlayer';
import { documentPath, useDocument } from '../../hooks/useDocuments';
import { listenPath, useListen } from '../../hooks/useListens';
import { useMenu } from '../../hooks/useMenu';
import { useReadAloud } from '../../hooks/useReadAloud';
import type { DocumentSummary, ListenDetail, ListenSummary } from '../../services/api/types';
import { AudioPlayer } from '../AudioPlayer';
import { ListenCard, ListenProgress, ListenReadButton, TranscriptCard } from '../ListenParts';
import { ReadToMeButton } from '../ReadToMeButton';
import { GalleryDeleteSheet } from '../GalleryDeleteSheet';
import { ClipPanel } from './ClipPanel';
import { documentMenuItems, MacDocumentDialogs, type DocumentAsk } from './MacDocumentOptions';
import { listenMenuItems, MacListenDialogs, type ListenAsk } from './MacListenOptions';
import '../ListenParts.css';
import './GalleryItemPanel.css';

/** The ⋯ button and its menu. */
function MoreButton({ label, onOpen }: { label: string; onOpen: (event: MouseEvent<HTMLButtonElement>) => void }) {
  return (
    <button type="button" className="mac-button mac-button--icon" aria-label={label} aria-haspopup="menu" onClick={onOpen}>
      <Icon name="more" size="xs" />
    </button>
  );
}

function RecordingBody({ listen, onChanged, onDeleted }: { listen: ListenDetail; onChanged: () => void; onDeleted: () => void }) {
  const player = useAudioPlayer((listen.duration_ms ?? 0) / 1000);
  const menu = useMenu();
  const [ask, setAsk] = useState<ListenAsk>(null);
  const [isDeleting, setDeleting] = useState(false);
  const title = listenTitle(listen);
  const pill = listenPill(listen);
  return (
    <>
      {listen.audio_url !== null && <AudioPlayer src={listen.audio_url} name={listen.source_name} player={player} />}
      <h2 className="gallery-item__title">{title}</h2>
      <span className="gallery-item__sub">{listenPanelLine(listen)}</span>
      {isListenBusy(listen.status) ? (
        <div className="listen-card">
          <ListenProgress listen={listen} />
        </div>
      ) : listen.status === 'failed' ? (
        <span className="gallery-item__sub">{listen.error ?? ILISTEN_COPY.failedBody}</span>
      ) : (
        <>
          <ListenCard title={ILISTEN_COPY.summary} side={<span className={`listen-pill listen-pill--${pill.tone === 'warning' ? 'warn' : 'ok'}`}>{pill.label}</span>}>
            <p className="listen-summary">{listen.summary}</p>
          </ListenCard>
          {listen.turns.length > 0 && (
            <TranscriptCard
              listen={listen}
              {...(listen.audio_url === null
                ? {}
                : {
                    atMs: player.atS * 1000,
                    onSeek: (ms: number) => {
                      player.seek(ms / 1000);
                    },
                  })}
            />
          )}
          <span className="gallery-item__actions">
            <Link to={listenPath(listen.id)} className="mac-button mac-button--primary">
              Open in iListen
            </Link>
            <ListenReadButton listen={listen} className="mac-button" messageClassName="gallery-item__sub" />
            <MoreButton label={ILISTEN_COPY.options} onOpen={menu.openFromButton} />
          </span>
          <Menu anchor={menu.anchor} label={title} onClose={menu.close} className="mac-menu--narrow" items={listenMenuItems({ listenId: listen.id, title }, (next) => {
              // Delete stays on the Gallery; the iListen page's own delete leaves for its list.
              if (next?.kind === 'delete') setDeleting(true);
              else setAsk(next);
            })}
          />
          <MacListenDialogs
            ask={ask}
            onClose={() => {
              setAsk(null);
            }}
            onRenamed={onChanged}
          />
          <GalleryDeleteSheet
            itemIds={isDeleting ? [recordingItemId(listen.id)] : []}
            onCancel={() => {
              setDeleting(false);
            }}
            onDone={() => {
              setDeleting(false);
              onDeleted();
            }}
          />
        </>
      )}
    </>
  );
}

/**
 * A recording's column.
 * @param props - The list row, and what reloads the Gallery after a rename or delete.
 * @returns The column.
 */
export function GalleryRecordingPanel({ summary, onChanged }: { summary: ListenSummary; onChanged: () => void }) {
  const { state, refresh } = useListen(summary.id);
  return (
    <ClipPanel>
      <div className="gallery-item">
        {state.status === 'ready' ? (
          <RecordingBody
            listen={state.data}
            onChanged={() => {
              refresh();
              onChanged();
            }}
            onDeleted={onChanged}
          />
        ) : (
          <Skeleton kind="line" />
        )}
      </div>
    </ClipPanel>
  );
}

/**
 * A document's column.
 * @param props - The list row, and what reloads the Gallery after a rename or delete.
 * @returns The column.
 */
export function GalleryDocumentPanel({ summary, onChanged }: { summary: DocumentSummary; onChanged: () => void }) {
  const { state, refresh } = useDocument(summary.id);
  const player = useReadAloud();
  const menu = useMenu();
  const [ask, setAsk] = useState<DocumentAsk>(null);
  const [isDeleting, setDeleting] = useState(false);
  const doc = state.status === 'ready' ? state.data : null;
  const page = doc?.pages[0]?.image_url ?? summary.thumb_url;
  const title = docTitle(doc ?? summary);
  const changed = () => {
    refresh();
    onChanged();
  };
  return (
    <ClipPanel>
      <div className="gallery-item">
        {page !== null && (
          <Link to={documentPath(summary.id)} className="gallery-item__page" aria-label={IREAD_COPY.showPage}>
            <img src={page} alt="" />
          </Link>
        )}
        <h2 className="gallery-item__title">{title}</h2>
        <span className="gallery-item__sub">{docMetaLine(doc ?? summary, true)}</span>
        {doc !== null && !isDocBusy(doc.status) && doc.status !== 'failed' && (
          <>
            <ListenCard>
              <p className="listen-summary">{doc.summary}</p>
            </ListenCard>
            <span className="gallery-item__actions">
              <Link to={documentPath(doc.id)} className="mac-button mac-button--primary">
                Open in iRead
              </Link>
              <ReadToMeButton doc={doc} player={player} className="mac-button" messageClassName="gallery-item__sub" />
              <MoreButton label={IREAD_COPY.options} onOpen={menu.openFromButton} />
            </span>
            <Menu anchor={menu.anchor} label={title} onClose={menu.close} className="mac-menu--narrow" items={documentMenuItems({ documentId: doc.id, title }, (next) => {
                // Delete stays on the Gallery; the iRead page's own delete leaves for its list.
                if (next?.kind === 'delete') setDeleting(true);
                else setAsk(next);
              })}
            />
            <MacDocumentDialogs
              ask={ask}
              onClose={() => {
                setAsk(null);
              }}
              onRenamed={changed}
            />
            <GalleryDeleteSheet
              itemIds={isDeleting ? [documentItemId(doc.id)] : []}
              onCancel={() => {
                setDeleting(false);
              }}
              onDone={() => {
                setDeleting(false);
                onChanged();
              }}
            />
          </>
        )}
      </div>
    </ClipPanel>
  );
}
