// A recording on the phone (`/ilisten/:id`, mock frame 3), laid out as an iRead letter is: the Back
// header with the title, the length and speakers, and Rename; the languages heard; the check score
// ("Checked · passed on v2"); the summary in the output language; Read it to me; the "Summary in"
// select (a new pick writes the summary again, the transcript stays); "What was said (5 lines)",
// which opens the lines; and the recording's player (a tapped line plays from there). While it listens, the progress list with the check loop. Delete recording
// at the bottom.
import { useState } from 'react';
import { useParams } from 'react-router';
import { BackHeader } from '../components/BackHeader';
import { CheckCard, LangChips, LanguageSelect, ListenPlayback, ListenProgress, ListenReadButton, SummaryCard } from '../components/ListenParts';
import { LoadError } from '../components/LoadError';
import { RenameSheet } from '../components/RenameSheet';
import { LISTEN_DELETE_COPY } from '../core/delete-copy';
import { ILISTEN_COPY, isListenBusy, listenFacts, listenTitle, listenTitleProblem } from '../core/ilisten/listens';
import { ConfirmSheet } from '../design/ConfirmSheet';
import { Skeleton } from '../design/Skeleton';
import { ILISTEN_PATH, useChangeListenLanguage, useDeleteListen, useListen, useRenameListen } from '../hooks/useListens';
import type { ListenDetail } from '../services/api/types';
import './GuidePage.css';
import './GuideStepPage.css';
import './IListenPage.css';

function Ready({ listen, refresh }: { listen: ListenDetail; refresh: () => void }) {
  const [isLinesShown, setLinesShown] = useState(false);
  const { change, isChanging } = useChangeListenLanguage(refresh);
  return (
    <>
      <CheckCard listen={listen} isCompact />
      <SummaryCard listen={listen} isLarge />
      <ListenReadButton listen={listen} className="guide-step__play" messageClassName="guide-page__muted" />
      <label className="ilisten-page__field">
        <span>{ILISTEN_COPY.summaryIn}</span>
        <LanguageSelect
          value={listen.target}
          label={ILISTEN_COPY.summaryIn}
          className="ilisten-page__select"
          isDisabled={isChanging}
          onChange={(target) => {
            if (target !== listen.target) void change(listen.id, target);
          }}
        />
      </label>
      {listen.turns.length > 0 && (
        <button
          type="button"
          className="ilisten-item__lines"
          aria-expanded={isLinesShown}
          onClick={() => {
            setLinesShown(!isLinesShown);
          }}
        >
          {`${ILISTEN_COPY.linesLink(listen.turns.length)} ${isLinesShown ? '‹' : '›'}`}
        </button>
      )}
      <ListenPlayback listen={listen} withTranscript={isLinesShown} />
    </>
  );
}

function Body({ listen, refresh }: { listen: ListenDetail; refresh: () => void }) {
  if (isListenBusy(listen.status)) {
    return (
      <section className="guide-page__making" aria-live="polite">
        <h2 className="guide-page__making-title">{ILISTEN_COPY.listeningTitle}</h2>
        <ListenProgress listen={listen} />
        <p className="guide-page__muted">{ILISTEN_COPY.leaveNote}</p>
      </section>
    );
  }
  if (listen.status === 'failed') {
    return (
      <section className="guide-page__making" role="alert">
        <h2 className="guide-page__making-title">{ILISTEN_COPY.failedTitle}</h2>
        <p className="guide-page__muted">{listen.error ?? ILISTEN_COPY.failedBody}</p>
      </section>
    );
  }
  return <Ready listen={listen} refresh={refresh} />;
}

/** "Rename" as a plain text button by the title, opening the rename sheet. */
function Rename({ listen, refresh }: { listen: ListenDetail; refresh: () => void }) {
  const [isOpen, setOpen] = useState(false);
  const renamer = useRenameListen(refresh);
  return (
    <>
      <button
        type="button"
        className="guide-page__rename"
        onClick={() => {
          setOpen(true);
        }}
      >
        {ILISTEN_COPY.rename}
      </button>
      <RenameSheet
        open={isOpen}
        heading={ILISTEN_COPY.renameTitle}
        label={ILISTEN_COPY.titleField}
        saveLabel="Save"
        title={listenTitle(listen)}
        problemOf={listenTitleProblem}
        isSaving={renamer.isSaving}
        onSave={(title) => renamer.rename(listen.id, title)}
        onClose={() => {
          setOpen(false);
        }}
      />
    </>
  );
}

/** "Delete recording" as a plain text button, behind the confirm sheet. */
function Delete({ listenId }: { listenId: string }) {
  const [isAsking, setAsking] = useState(false);
  const { remove, isDeleting } = useDeleteListen();
  return (
    <>
      <button
        type="button"
        className="guide-page__delete"
        onClick={() => {
          setAsking(true);
        }}
      >
        {LISTEN_DELETE_COPY.confirmLabel}
      </button>
      <ConfirmSheet
        open={isAsking}
        title={LISTEN_DELETE_COPY.title}
        body={LISTEN_DELETE_COPY.body}
        confirmLabel={LISTEN_DELETE_COPY.confirmLabel}
        busyLabel="Deleting…"
        isBusy={isDeleting}
        onConfirm={() => {
          void remove(listenId);
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
 * @returns The recording by its route id.
 */
export function IListenItemPage() {
  const { id = '' } = useParams();
  const { state, refresh } = useListen(id);
  const listen = state.status === 'ready' ? state.data : null;
  return (
    <div className="guide-page">
      <div className="guide-page__head">
        <BackHeader
          title={listen === null ? ILISTEN_COPY.section : listenTitle(listen)}
          subtitle={listen === null ? ILISTEN_COPY.section : listenFacts(listen) || ILISTEN_COPY.section}
          fallback={ILISTEN_PATH}
          actions={listen !== null && !isListenBusy(listen.status) ? <Rename listen={listen} refresh={refresh} /> : undefined}
        />
      </div>
      <div className="guide-page__body">
        {state.status === 'loading' && (
          <div aria-busy="true">
            <p className="visually-hidden" role="status">
              Loading the recording…
            </p>
            <Skeleton kind="line" />
            <Skeleton kind="line" />
          </div>
        )}
        {state.status === 'error' && <LoadError error={state.error} thing="recording" onRetry={refresh} />}
        {listen !== null && listen.languages.length > 0 && (
          <span className="ilisten-item__sub">
            <LangChips listen={listen} facts="" />
          </span>
        )}
        {listen !== null && <Body listen={listen} refresh={refresh} />}
        {listen !== null && !isListenBusy(listen.status) && <Delete listenId={listen.id} />}
      </div>
    </div>
  );
}
