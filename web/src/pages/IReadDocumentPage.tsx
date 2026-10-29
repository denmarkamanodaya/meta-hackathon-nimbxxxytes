// A letter on the phone (`/iread/:id`, V50–V51), laid out as an iGuide is (owner ruling
// 2026-10-29: iRead looks and sizes exactly like iGuide): the Back header with the title, who it is
// from and Rename; the summary in 24 px (the one large-print element, owner ruling). Read it to me
// at iGuide's Play size (the summary first, then the whole letter; "Stop reading" while it reads)
// and Hold to ask a question at iGuide's Back size (the mic while held; let go and Muse Spark
// answers from the page, read out loud, in 24 px under "You asked: …"). Show the page opens the
// page images. While Muse Spark reads the letter, the Pages → Read → Voice progress list; Delete
// letter at the bottom follows the iGuide page.
import { useState } from 'react';
import { useParams } from 'react-router';
import { BackHeader } from '../components/BackHeader';
import { StageList } from '../components/GuideStages';
import { LoadError } from '../components/LoadError';
import { ReadToMeButton } from '../components/ReadToMeButton';
import { RenameSheet } from '../components/RenameSheet';
import { waveHeights } from '../core/ask/voice';
import { DOCUMENT_DELETE_COPY } from '../core/delete-copy';
import { docFromLine, docStageRows, docTitle, documentTitleProblem, IREAD_COPY, isDocBusy, youAsked } from '../core/iread/documents';
import { Button } from '../design/Button';
import { ConfirmSheet } from '../design/ConfirmSheet';
import { Icon } from '../design/Icon';
import { Skeleton } from '../design/Skeleton';
import { Spinner } from '../design/Spinner';
import { IREAD_PATH, useAskDocument, useDeleteDocument, useDocument, useRenameDocument, type AskDocument } from '../hooks/useDocuments';
import { useReadAloud, type ReadAloud } from '../hooks/useReadAloud';
import { useVoiceNote } from '../hooks/useVoiceNote';
import type { DocumentDetail } from '../services/api/types';
import '../components/ReadAloudBar.css';
import './GuidePage.css';
import './GuideStepPage.css';
import './IReadDocumentPage.css';

/** The wave while the voice plays, px (the mock's 30 bars, 10–34 px). */
const WAVE = waveHeights(30, 10, 24);

/** The voice bar's wave, every bar lit and moving. */
function Wave() {
  return (
    <div aria-hidden="true">
      <span className="read-bar__wave">
        {WAVE.map((height, index) => (
          <span
            key={index}
            className="read-bar__wave-bar read-bar__wave-bar--lit read-bar__wave-bar--moving"
            style={{ height: `${String(height)}px`, animationDelay: `${String((index % 6) * 120)}ms` }}
          />
        ))}
      </span>
    </div>
  );
}

/** Hold to ask: the mic while held; let go, and the answer is read out loud. */
function HoldToAsk({ asker, player }: { asker: AskDocument; player: ReadAloud }) {
  const voice = useVoiceNote((text) => {
    void asker.ask(text).then((answer) => {
      if (answer !== null) player.playAnswer(answer.answer, answer.audio_url);
    });
  });
  const isHolding = voice.phase === 'starting' || voice.phase === 'recording';
  const isBusy = voice.phase === 'transcribing' || asker.asking !== null;
  return (
    <>
      <button
        type="button"
        className={isHolding ? 'guide-step__back iread-doc__hold iread-doc__hold--on' : 'guide-step__back iread-doc__hold'}
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
        {isBusy ? <Spinner /> : <Icon name="mic" size="md" />}
        {isHolding ? IREAD_COPY.listening : isBusy ? IREAD_COPY.thinking : IREAD_COPY.holdToAsk}
      </button>
      {voice.message !== null && (
        <p className="guide-page__muted" role="status">
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
          <span className="guide-page__muted">{youAsked(answer.question)}</span>
          <p className="iread-doc__big">{answer.answer}</p>
          {answer.audio_url === null && !player.canSpeak && <span className="guide-page__muted">{IREAD_COPY.noVoice}</span>}
        </>
      )}
      {player.status === 'playing' && <Wave />}
      <span className="guide-step__grow" />
      <ReadToMeButton doc={doc} player={player} className="guide-step__play iread-doc__read" messageClassName="guide-page__muted" />
      <HoldToAsk asker={asker} player={player} />
      <Button
        variant="ghost"
        aria-expanded={isPageShown}
        onClick={() => {
          setPageShown(!isPageShown);
        }}
      >
        {isPageShown ? IREAD_COPY.hidePage : IREAD_COPY.showPage}
      </Button>
      {isPageShown && doc.pages.map((page) => <img key={page.n} className="iread-doc__page" src={page.image_url} alt={`Page ${String(page.n)}`} />)}
    </>
  );
}

function Body({ doc }: { doc: DocumentDetail }) {
  if (isDocBusy(doc.status)) {
    return (
      <section className="guide-page__making" aria-live="polite">
        <h2 className="guide-page__making-title">{IREAD_COPY.readingTitle}</h2>
        <p className="guide-page__muted">{IREAD_COPY.readingLine}</p>
        <StageList rows={docStageRows(doc.status)} />
      </section>
    );
  }
  if (doc.status === 'failed') {
    return (
      <section className="guide-page__making" role="alert">
        <h2 className="guide-page__making-title">{IREAD_COPY.failedTitle}</h2>
        <p className="guide-page__muted">{doc.error ?? IREAD_COPY.failedBody}</p>
      </section>
    );
  }
  return <Ready doc={doc} />;
}

/** "Rename" as a plain text button by the title, opening the rename sheet. */
function Rename({ doc, refresh }: { doc: DocumentDetail; refresh: () => void }) {
  const [isOpen, setOpen] = useState(false);
  const renamer = useRenameDocument(refresh);
  return (
    <>
      <button
        type="button"
        className="guide-page__rename"
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

/** "Delete letter" as a plain text button, behind the confirm sheet. */
function Delete({ documentId }: { documentId: string }) {
  const [isAsking, setAsking] = useState(false);
  const { remove, isDeleting } = useDeleteDocument();
  return (
    <>
      <button
        type="button"
        className="guide-page__delete"
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
  const from = doc === null ? '' : docFromLine(doc);
  return (
    <div className="guide-page">
      <div className="guide-page__head">
        <BackHeader
          title={doc === null ? IREAD_COPY.section : docTitle(doc)}
          subtitle={from === '' ? IREAD_COPY.section : from}
          fallback={IREAD_PATH}
          actions={doc !== null && !isDocBusy(doc.status) ? <Rename doc={doc} refresh={refresh} /> : undefined}
        />
      </div>
      <div className="guide-page__body">
        {state.status === 'loading' && (
          <div aria-busy="true">
            <p className="visually-hidden" role="status">
              Loading the letter…
            </p>
            <Skeleton kind="video" />
            <Skeleton kind="line" />
          </div>
        )}
        {state.status === 'error' && <LoadError error={state.error} thing="letter" onRetry={refresh} />}
        {doc !== null && <Body doc={doc} />}
        {doc !== null && !isDocBusy(doc.status) && <Delete documentId={doc.id} />}
      </div>
    </div>
  );
}
