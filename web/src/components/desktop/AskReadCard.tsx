// The Ask box's card for a letter (V47 plan, V48 answer): "iRead", the letter's title and who
// planned or answered it, "You asked: …". Before Run, the three steps (read the page, answer,
// read it out loud) with Cancel and Read and answer; while it runs, the bar and the steps; once
// answered, the answer in 24 px read out loud at once, the voice bar (Play / Pause), Read the
// whole letter and Done.
import { useEffect, useMemo } from 'react';
import { barView, rowViews, type AskJob } from '../../core/ask/jobs';
import { planRows, type DocumentFacts, type PlanContext } from '../../core/ask/plan';
import { docTitle, IREAD_COPY, youAsked } from '../../core/iread/documents';
import { FROM_PART_ZERO } from '../../core/iread/read-aloud';
import { useAsk } from '../../hooks/useAsk';
import { useDocument } from '../../hooks/useDocuments';
import { useReadAloud, type ReadAloud } from '../../hooks/useReadAloud';
import type { DocumentAnswer, IntentAnswer } from '../../services/api/types';
import { ReadAloudBar } from '../ReadAloudBar';
import type { AskCardBox } from './AskPlanCard';
import { AskBar, AskSteps } from './AskSteps';
import './AskPlanCard.css';
import './AskReadCard.css';

/** Answers already read out once (the card may be drawn again from the list): never twice by itself. */
const spoken = new WeakSet<IntentAnswer>();

/** Props for `AskReadCard`. */
export interface AskReadCardProps {
  job: AskJob;
  ctx: PlanContext;
  box: AskCardBox;
}

function Answer({ job, answer, player }: { job: AskJob; answer: DocumentAnswer; player: ReadAloud }) {
  const { playUrl } = player;
  useEffect(() => {
    if (spoken.has(job.intent)) return;
    spoken.add(job.intent);
    playUrl(answer.audio_url);
  }, [job.intent, answer.audio_url, playUrl]);
  return (
    <>
      <p className="ask-read__answer">{answer.answer}</p>
      <ReadAloudBar
        player={player}
        hasVoice={answer.audio_url !== null || player.item !== null}
        onPlay={() => {
          playUrl(answer.audio_url);
        }}
      />
    </>
  );
}

/**
 * The card.
 * @param props - See `AskReadCardProps`.
 * @returns The card.
 */
export function AskReadCard({ job, ctx, box }: AskReadCardProps) {
  const { run, dismiss, stop } = useAsk();
  const documentId = job.intent.document_ids[0] ?? '';
  const { state } = useDocument(documentId);
  const player = useReadAloud();
  const doc = state.status === 'ready' ? state.data : null;
  const readCtx = useMemo<PlanContext>(() => {
    const facts: DocumentFacts | null =
      doc === null ? null : { title: doc.title, isRead: doc.status === 'ready', pageCount: doc.page_count, text: doc.text };
    return { ...ctx, documentFacts: (id) => (id === documentId ? facts : null) };
  }, [ctx, doc, documentId]);
  const rows = rowViews(job, readCtx);
  const title = doc === null ? job.intent.title : docTitle(doc);
  const close = () => {
    dismiss(job.id);
  };

  let by: string = IREAD_COPY.plannedBy;
  if (job.status === 'running') by = 'Working';
  if (job.status === 'done') by = IREAD_COPY.answeredBy;
  if (job.status === 'failed') by = 'Stopped';

  const asked = youAsked(job.intent.question ?? job.text);
  const isAnswered = job.status === 'done' && job.answer !== null;

  return (
    <section className="ask-card" aria-label={title}>
      <div className="ask-card__head">
        <span className="ask-card__badge">{IREAD_COPY.section}</span>
        <h2 className="ask-card__title">{title}</h2>
        <span className="ask-card__by">{by}</span>
      </div>
      <p className="ask-card__line" role={job.status === 'failed' ? 'alert' : undefined}>
        {job.status === 'failed' ? (job.error ?? 'It stopped.') : asked}
      </p>
      {job.status === 'running' && <AskBar bar={barView(job, planRows(job.intent, readCtx))} isDone={false} />}
      {!isAnswered && job.status !== 'failed' && <AskSteps rows={rows} />}
      {isAnswered && job.answer !== null && <Answer job={job} answer={job.answer} player={player} />}
      <div className="ask-card__foot">
        <span className="ask-card__note">{isAnswered ? IREAD_COPY.readNote : ''}</span>
        {job.status === 'plan' && (
          <>
            <button
              type="button"
              className="mac-button"
              onClick={() => {
                close();
                box.onCleared();
              }}
            >
              Cancel
            </button>
            <button
              type="button"
              className="mac-button mac-button--primary"
              onClick={() => {
                run(job.id);
                box.onCleared();
              }}
            >
              {IREAD_COPY.readAndAnswer}
            </button>
          </>
        )}
        {job.status === 'running' && (
          <button
            type="button"
            className="mac-button"
            onClick={() => {
              stop(job.id);
            }}
          >
            Stop
          </button>
        )}
        {job.status === 'done' && (
          <>
            <button
              type="button"
              className="mac-button"
              onClick={() => {
                player.readDocument(documentId, FROM_PART_ZERO, null);
              }}
            >
              {IREAD_COPY.readWhole}
            </button>
            <button type="button" className="mac-button" onClick={close}>
              {IREAD_COPY.done}
            </button>
          </>
        )}
        {job.status === 'failed' && (
          <>
            <button type="button" className="mac-button" onClick={close}>
              Close
            </button>
            <button
              type="button"
              className="mac-button mac-button--primary"
              onClick={() => {
                close();
                box.onEdit(job.text);
              }}
            >
              Edit request
            </button>
          </>
        )}
      </div>
    </section>
  );
}
