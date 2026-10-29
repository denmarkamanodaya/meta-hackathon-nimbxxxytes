// A letter on the Mac (`/iread/:id`): "‹ iRead / title", who it is from and ⋯ (Rename…, Delete
// letter…); the page images down the left (a click zooms one to full width and back); on the right
// the summary and the full text in large type, Read it to me, and a question field with hold to
// talk whose answer shows in 24 px and is read out loud. While Muse Spark reads it, that is said.
import { useState, type SyntheticEvent } from 'react';
import { useParams } from 'react-router';
import { LoadError } from '../../components/LoadError';
import { ReadAloudBar } from '../../components/ReadAloudBar';
import { ReadToMeButton } from '../../components/ReadToMeButton';
import { MacColumns, MacCrumb } from '../../components/desktop/MacColumns';
import { MacDocumentOptions } from '../../components/desktop/MacDocumentOptions';
import { docFromLine, docTitle, IREAD_COPY, isDocBusy, youAsked } from '../../core/iread/documents';
import { Icon } from '../../design/Icon';
import { Skeleton } from '../../design/Skeleton';
import { Spinner } from '../../design/Spinner';
import { IREAD_PATH, useAskDocument, useDocument } from '../../hooks/useDocuments';
import { useReadAloud, type ReadAloud } from '../../hooks/useReadAloud';
import { useVoiceNote } from '../../hooks/useVoiceNote';
import type { DocumentDetail } from '../../services/api/types';
import './MacIReadDocumentPage.css';

function Pages({ doc }: { doc: DocumentDetail }) {
  const [zoomed, setZoomed] = useState<number | null>(null);
  return (
    <div className="mac-letter__pages">
      {doc.pages.map((page) => (
        <button
          key={page.n}
          type="button"
          className={zoomed === page.n ? 'mac-letter__page mac-letter__page--zoomed' : 'mac-letter__page'}
          aria-pressed={zoomed === page.n}
          aria-label={`Page ${String(page.n)}: ${zoomed === page.n ? 'zoom out' : 'zoom in'}`}
          onClick={() => {
            setZoomed(zoomed === page.n ? null : page.n);
          }}
        >
          <img src={page.image_url} alt="" />
        </button>
      ))}
    </div>
  );
}

/** The question field; its answer plays through the page's one player, so voices never overlap. */
function Ask({ doc, player }: { doc: DocumentDetail; player: ReadAloud }) {
  const [draft, setDraft] = useState('');
  const asker = useAskDocument(doc.id);
  const ask = (question: string) => {
    void asker.ask(question).then((answer) => {
      if (answer !== null) player.playUrl(answer.audio_url);
    });
  };
  const voice = useVoiceNote((text) => {
    setDraft(text);
    ask(text);
  });
  const isRecording = voice.phase === 'starting' || voice.phase === 'recording';
  const onSubmit = (event: SyntheticEvent) => {
    event.preventDefault();
    if (draft.trim() !== '') ask(draft);
  };
  return (
    <section className="mac-letter__ask" aria-label={IREAD_COPY.askLabel}>
      <form className="mac-letter__ask-row" onSubmit={onSubmit}>
        <input
          className="mac-letter__ask-input"
          aria-label={IREAD_COPY.askLabel}
          placeholder={IREAD_COPY.askPlaceholder}
          value={draft}
          maxLength={500}
          onChange={(event) => {
            setDraft(event.target.value);
          }}
        />
        <button
          type="button"
          className={isRecording ? 'mac-button mac-letter__mic mac-letter__mic--on' : 'mac-button mac-letter__mic'}
          aria-label={isRecording ? 'Recording: let go to ask' : 'Hold to ask'}
          aria-pressed={isRecording}
          disabled={voice.phase === 'transcribing'}
          onPointerDown={(event) => {
            if (event.button !== 0) return;
            event.currentTarget.setPointerCapture(event.pointerId);
            voice.press();
          }}
          onPointerUp={voice.release}
          onPointerCancel={voice.release}
        >
          <Icon name="mic" size="sm" />
        </button>
        <button type="submit" className="mac-button mac-button--primary" disabled={draft.trim() === '' || asker.asking !== null}>
          {IREAD_COPY.ask}
        </button>
      </form>
      {voice.message !== null && <p className="mac-letter__muted">{voice.message}</p>}
      {asker.asking !== null && (
        <p className="mac-letter__muted" role="status">
          <Spinner />
          {IREAD_COPY.thinking}
        </p>
      )}
      {asker.answer !== null && (
        <>
          <span className="mac-letter__muted">{youAsked(asker.answer.question)}</span>
          <p className="mac-letter__answer">{asker.answer.answer}</p>
          <ReadAloudBar
            player={player}
            hasVoice={asker.answer.audio_url !== null}
            onPlay={() => {
              player.playUrl(asker.answer?.audio_url ?? null);
            }}
          />
        </>
      )}
    </section>
  );
}

function Ready({ doc }: { doc: DocumentDetail }) {
  const player = useReadAloud();
  return (
    <div className="mac-letter__columns">
      <Pages doc={doc} />
      <div className="mac-letter__read">
        <p className="mac-letter__summary">{doc.summary}</p>
        <ReadToMeButton doc={doc} player={player} className="mac-letter__read-button" messageClassName="mac-letter__muted" />
        <Ask doc={doc} player={player} />
        <h2 className="mac-letter__heading">The whole letter</h2>
        <p className="mac-letter__text">{doc.text}</p>
        <span className="mac-letter__muted">{IREAD_COPY.readNote}</span>
      </div>
    </div>
  );
}

function Body({ doc }: { doc: DocumentDetail }) {
  if (isDocBusy(doc.status)) {
    return (
      <div className="mac-letter__state" aria-live="polite">
        <Spinner />
        <span className="mac-letter__state-title">{IREAD_COPY.readingTitle}</span>
        <span className="mac-letter__muted">{IREAD_COPY.readingLine}</span>
      </div>
    );
  }
  if (doc.status === 'failed') {
    return (
      <div className="mac-letter__state" role="alert">
        <span className="mac-letter__state-title">{IREAD_COPY.failedTitle}</span>
        <span className="mac-letter__muted">{doc.error ?? IREAD_COPY.failedBody}</span>
      </div>
    );
  }
  return <Ready doc={doc} />;
}

/**
 * The page (`/iread/:id` in the Mac app).
 * @returns The page.
 */
export function MacIReadDocumentPage() {
  const { id = '' } = useParams();
  const { state, refresh } = useDocument(id);
  const doc = state.status === 'ready' ? state.data : null;
  return (
    <MacColumns>
      <header className="mac-columns__head mac-columns__head--crumb">
        <MacCrumb to={IREAD_PATH} label={IREAD_COPY.section} />
        <h1 className="mac-columns__crumb-title mac-letter__head-title">{doc === null ? '' : docTitle(doc)}</h1>
        {doc !== null && <span className="mac-letter__from">{docFromLine(doc)}</span>}
        {doc !== null && !isDocBusy(doc.status) && <MacDocumentOptions doc={{ documentId: doc.id, title: docTitle(doc) }} onRenamed={refresh} />}
      </header>
      {state.status === 'loading' && (
        <div className="mac-letter__state" aria-busy="true">
          <p className="visually-hidden" role="status">
            Loading the letter…
          </p>
          <Skeleton kind="line" />
        </div>
      )}
      {state.status === 'error' && <LoadError error={state.error} thing="letter" onRetry={refresh} />}
      {doc !== null && <Body doc={doc} />}
    </MacColumns>
  );
}
