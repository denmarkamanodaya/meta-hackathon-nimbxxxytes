// A letter on the phone (`/iread/:id`, V50–V51): "‹ iRead", the title in large type, who it is
// from, and the summary in 24 px. A huge Read it to me (the summary first, then the whole letter;
// "Stop reading" while it reads) and Hold to ask a question (the mic while held; let go and Muse
// Spark answers from the page, read out loud, in 24 px under "You asked: …"). Show the page opens
// the page images. While Muse Spark reads the letter, that is said; Rename by the title and Delete
// letter at the bottom follow the iGuide page.
import { useState } from 'react';
import { Link, useParams } from 'react-router';
import { LoadError } from '../components/LoadError';
import { ReadToMeButton } from '../components/ReadToMeButton';
import { RenameSheet } from '../components/RenameSheet';
import { waveHeights } from '../core/ask/voice';
import { DOCUMENT_DELETE_COPY } from '../core/delete-copy';
import { docFromLine, docTitle, documentTitleProblem, IREAD_COPY, isDocBusy, youAsked } from '../core/iread/documents';
import { ConfirmSheet } from '../design/ConfirmSheet';
import { Icon } from '../design/Icon';
import { Skeleton } from '../design/Skeleton';
import { Spinner } from '../design/Spinner';
import { IREAD_PATH, useAskDocument, useDeleteDocument, useDocument, useRenameDocument, type AskDocument } from '../hooks/useDocuments';
import { useReadAloud, type ReadAloud } from '../hooks/useReadAloud';
import { useVoiceNote } from '../hooks/useVoiceNote';
import type { DocumentDetail } from '../services/api/types';
import './IReadDocumentPage.css';

/** The wave while the voice plays, px (the mock's 30 bars, 10–34 px). */
const WAVE = waveHeights(30, 10, 24);

function Wave() {
  return (
    <span className="iread-doc__wave" aria-hidden="true">
      {WAVE.map((height, index) => (
        <span key={index} className="iread-doc__wave-bar" style={{ height: `${String(height)}px`, animationDelay: `${String((index % 6) * 120)}ms` }} />
      ))}
    </span>
  );
}

/** Hold to ask: the mic while held; let go, and the answer is read out loud. */
function HoldToAsk({ asker, player }: { asker: AskDocument; player: ReadAloud }) {
  const voice = useVoiceNote((text) => {
    void asker.ask(text).then((answer) => {
      if (answer !== null) player.playUrl(answer.audio_url);
    });
  });
  const isHolding = voice.phase === 'starting' || voice.phase === 'recording';
  const isBusy = voice.phase === 'transcribing' || asker.asking !== null;
  return (
    <>
      <button
        type="button"
        className={isHolding ? 'iread-doc__hold iread-doc__hold--on' : 'iread-doc__hold'}
        aria-pressed={isHolding}
        disabled={isBusy}
        onPointerDown={(event) => {
          if (event.button !== 0) return;
          event.currentTarget.setPointerCapture(event.pointerId);
          player.stop();
          voice.press();
        }}
        onPointerUp={() => {
          // The answer arrives later, outside this tap: unlock playback now (iOS).
          player.prime();
          voice.release();
        }}
        onPointerCancel={voice.release}
        onContextMenu={(event) => {
          event.preventDefault();
        }}
      >
        {isBusy ? <Spinner /> : <Icon name="mic" size="default" />}
        <span className="iread-doc__hold-label">{isHolding ? IREAD_COPY.listening : isBusy ? IREAD_COPY.thinking : IREAD_COPY.holdToAsk}</span>
      </button>
      {voice.message !== null && (
        <p className="iread-doc__muted" role="status">
          {voice.message}
        </p>
      )}
    </>
  );
}

function Ready({ doc }: { doc: DocumentDetail }) {
  const player = useReadAloud();
  const asker = useAskDocument(doc.id);
  const [isPageShown, setPageShown] = useState(false);
  const { answer } = asker;
  return (
    <>
      {answer === null ? (
        <p className="iread-doc__big">{doc.summary}</p>
      ) : (
        <>
          <span className="iread-doc__muted">{youAsked(answer.question)}</span>
          <p className="iread-doc__big">{answer.answer}</p>
          {answer.audio_url === null && <span className="iread-doc__muted">{IREAD_COPY.noVoice}</span>}
        </>
      )}
      {player.status === 'playing' && <Wave />}
      <span className="iread-doc__grow" />
      <ReadToMeButton doc={doc} player={player} className="iread-doc__read" messageClassName="iread-doc__muted" />
      <HoldToAsk asker={asker} player={player} />
      <button
        type="button"
        className="iread-doc__link"
        aria-expanded={isPageShown}
        onClick={() => {
          setPageShown(!isPageShown);
        }}
      >
        {isPageShown ? IREAD_COPY.hidePage : IREAD_COPY.showPage}
      </button>
      {isPageShown && (
        <div className="iread-doc__pages">
          {doc.pages.map((page) => (
            <img key={page.n} className="iread-doc__page" src={page.image_url} alt={`Page ${String(page.n)}`} />
          ))}
        </div>
      )}
    </>
  );
}

function Body({ doc }: { doc: DocumentDetail }) {
  if (isDocBusy(doc.status)) {
    return (
      <section className="iread-doc__state" aria-live="polite">
        <Spinner />
        <p className="iread-doc__big">{IREAD_COPY.readingLine}</p>
      </section>
    );
  }
  if (doc.status === 'failed') {
    return (
      <section className="iread-doc__state" role="alert">
        <p className="iread-doc__big">{IREAD_COPY.failedTitle}</p>
        <p className="iread-doc__muted">{doc.error ?? IREAD_COPY.failedBody}</p>
      </section>
    );
  }
  return <Ready doc={doc} />;
}

function Rename({ doc, refresh }: { doc: DocumentDetail; refresh: () => void }) {
  const [isOpen, setOpen] = useState(false);
  const renamer = useRenameDocument(refresh);
  return (
    <>
      <button
        type="button"
        className="iread-doc__top-link"
        onClick={() => {
          setOpen(true);
        }}
      >
        {IREAD_COPY.rename}
      </button>
      <RenameSheet
        open={isOpen}
        heading={IREAD_COPY.renameTitle}
        label={IREAD_COPY.titleField}
        saveLabel="Save"
        title={docTitle(doc)}
        problemOf={documentTitleProblem}
        isSaving={renamer.isSaving}
        onSave={(title) => renamer.rename(doc.id, title)}
        onClose={() => {
          setOpen(false);
        }}
      />
    </>
  );
}

function Delete({ documentId }: { documentId: string }) {
  const [isAsking, setAsking] = useState(false);
  const { remove, isDeleting } = useDeleteDocument();
  return (
    <>
      <button
        type="button"
        className="iread-doc__delete"
        onClick={() => {
          setAsking(true);
        }}
      >
        {DOCUMENT_DELETE_COPY.confirmLabel}
      </button>
      <ConfirmSheet
        open={isAsking}
        title={DOCUMENT_DELETE_COPY.title}
        body={DOCUMENT_DELETE_COPY.body}
        confirmLabel={DOCUMENT_DELETE_COPY.confirmLabel}
        busyLabel="Deleting…"
        isBusy={isDeleting}
        onConfirm={() => {
          void remove(documentId);
        }}
        onCancel={() => {
          setAsking(false);
        }}
      />
    </>
  );
}

/**
 * The page.
 * @returns The letter by its route id.
 */
export function IReadDocumentPage() {
  const { id = '' } = useParams();
  const { state, refresh } = useDocument(id);
  const doc = state.status === 'ready' ? state.data : null;
  return (
    <div className="iread-doc">
      <header className="iread-doc__head">
        <Link className="iread-doc__back" to={IREAD_PATH}>
          <Icon name="back" size="md" />
          {IREAD_COPY.section}
        </Link>
        {doc !== null && !isDocBusy(doc.status) && <Rename doc={doc} refresh={refresh} />}
      </header>
      {state.status === 'loading' && (
        <div aria-busy="true">
          <p className="visually-hidden" role="status">
            Loading the letter…
          </p>
          <Skeleton kind="line" />
        </div>
      )}
      {state.status === 'error' && <LoadError error={state.error} thing="letter" onRetry={refresh} />}
      {doc !== null && (
        <>
          <h1 className="iread-doc__title">{docTitle(doc)}</h1>
          {docFromLine(doc) !== '' && <span className="iread-doc__from">{docFromLine(doc)}</span>}
          <Body doc={doc} />
          {!isDocBusy(doc.status) && <Delete documentId={doc.id} />}
        </>
      )}
    </div>
  );
}
