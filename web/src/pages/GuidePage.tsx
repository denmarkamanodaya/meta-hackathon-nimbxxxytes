// A guide on the phone (`/guides/:id`, MyWay). While it is made: "Making …" and the V33 stage list
// (polled). Refused: the V37 message. Failed: why. Ready: Start the guide (the V35 step view)
// and every step with its photo and Edit text. Once made, Rename by the title opens the rename
// sheet, and Delete guide at the bottom asks first, then opens the Guides list.
import { useState } from 'react';
import { Link, useParams } from 'react-router';
import { BackHeader } from '../components/BackHeader';
import { GuideDeleteSheet } from '../components/GuideDeleteSheet';
import { GuideEditSheet } from '../components/GuideEditSheet';
import { GuideRenameSheet } from '../components/GuideRenameSheet';
import { GuideRefused } from '../components/GuideRefused';
import { GuideStages } from '../components/GuideStages';
import { LoadError } from '../components/LoadError';
import { GUIDE_DELETE_COPY } from '../core/delete-copy';
import { fromClipLine, GUIDE_COPY, isGuideBusy } from '../core/guides';
import { Button, buttonClassName } from '../design/Button';
import { Skeleton } from '../design/Skeleton';
import { guideStepPath, useEditGuideStep, useGuide, useRenameGuide } from '../hooks/useGuides';
import type { Guide, GuideStep } from '../services/api/types';
import './GuidePage.css';

function Steps({ guide, onEdit }: { guide: Guide; onEdit: (step: GuideStep) => void }) {
  return (
    <ol className="guide-page__steps">
      {guide.steps.map((step) => (
        <li key={step.n} className="guide-page__step">
          <Link className="guide-page__step-open" to={guideStepPath(guide.id, step.n)}>
            <span className="guide-page__thumb">{step.image_url !== null && <img src={step.image_url} alt="" loading="lazy" />}</span>
            <span className="guide-page__step-text">
              <span className="guide-page__step-n">{`Step ${String(step.n)}`}</span>
              <span className="guide-page__step-title">{step.title}</span>
            </span>
          </Link>
          <Button
            variant="ghost"
            onClick={() => {
              onEdit(step);
            }}
          >
            {GUIDE_COPY.editText}
          </Button>
        </li>
      ))}
    </ol>
  );
}

function Ready({ guide, refresh }: { guide: Guide; refresh: () => void }) {
  const [editing, setEditing] = useState<GuideStep | null>(null);
  const editor = useEditGuideStep(guide.id, refresh);
  const first = guide.steps[0];
  return (
    <>
      {first !== undefined && (
        <Link className={buttonClassName('primary', 'lg')} to={guideStepPath(guide.id, first.n)}>
          {GUIDE_COPY.start}
        </Link>
      )}
      <Steps guide={guide} onEdit={setEditing} />
      <GuideEditSheet
        step={editing}
        editor={editor}
        onClose={() => {
          setEditing(null);
        }}
      />
    </>
  );
}

function Body({ guide, refresh }: { guide: Guide; refresh: () => void }) {
  if (isGuideBusy(guide.status)) {
    return (
      <section className="guide-page__making" aria-live="polite">
        <h2 className="guide-page__making-title">{`Making “${guide.title}”`}</h2>
        <p className="guide-page__muted">About a minute</p>
        <GuideStages status={guide.status} stage={guide.stage} />
      </section>
    );
  }
  if (guide.status === 'refused') return <GuideRefused reason={guide.safety_reason} linkClass={buttonClassName('primary', 'lg')} />;
  if (guide.status === 'failed') {
    return (
      <section className="guide-page__making" role="alert">
        <h2 className="guide-page__making-title">{GUIDE_COPY.failedTitle}</h2>
        <p className="guide-page__muted">{guide.error ?? 'Try making it again from the clip.'}</p>
      </section>
    );
  }
  return <Ready guide={guide} refresh={refresh} />;
}

/** "Rename" as a plain text button by the title, opening the rename sheet. */
function RenameGuide({ guide, refresh }: { guide: Guide; refresh: () => void }) {
  const [isOpen, setOpen] = useState(false);
  const renamer = useRenameGuide(refresh);
  return (
    <>
      <button
        type="button"
        className="guide-page__rename"
        onClick={() => {
          setOpen(true);
        }}
      >
        {GUIDE_COPY.rename}
      </button>
      <GuideRenameSheet
        open={isOpen}
        guideId={guide.id}
        title={guide.title}
        renamer={renamer}
        onClose={() => {
          setOpen(false);
        }}
      />
    </>
  );
}

/** "Delete guide" as a plain text button, behind the confirm sheet. */
function DeleteGuide({ guideId }: { guideId: string }) {
  const [isAsking, setAsking] = useState(false);
  return (
    <>
      <button
        type="button"
        className="guide-page__delete"
        onClick={() => {
          setAsking(true);
        }}
      >
        {GUIDE_DELETE_COPY.confirmLabel}
      </button>
      <GuideDeleteSheet
        open={isAsking}
        guideId={guideId}
        onCancel={() => {
          setAsking(false);
        }}
      />
    </>
  );
}

/**
 * The page.
 * @returns The guide by its route id.
 */
export function GuidePage() {
  const { id = '' } = useParams();
  const { state, refresh } = useGuide(id);
  const guide = state.status === 'ready' ? state.data : null;
  return (
    <div className="guide-page">
      <div className="guide-page__head">
        <BackHeader
          title={guide?.title ?? GUIDE_COPY.guides}
          subtitle={guide === null ? GUIDE_COPY.section : fromClipLine(guide.clip_title, guide.clip_duration_s)}
          fallback="/guides"
          actions={guide !== null && !isGuideBusy(guide.status) ? <RenameGuide guide={guide} refresh={refresh} /> : undefined}
        />
      </div>
      <div className="guide-page__body">
        {state.status === 'loading' && (
          <div aria-busy="true">
            <p className="visually-hidden" role="status">
              Loading iGuide…
            </p>
            <Skeleton kind="video" />
            <Skeleton kind="line" />
          </div>
        )}
        {state.status === 'error' && <LoadError error={state.error} thing="iGuide" onRetry={refresh} />}
        {guide !== null && <Body guide={guide} refresh={refresh} />}
        {guide !== null && !isGuideBusy(guide.status) && <DeleteGuide guideId={guide.id} />}
      </div>
    </div>
  );
}
