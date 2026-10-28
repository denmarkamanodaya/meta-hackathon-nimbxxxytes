// A guide on the Mac (MyWay, V34): "‹ Guides / title", where it came from and ⋯ (Delete guide…,
// asked first, as for a production); the steps down the left (photo, "Step n", title); the chosen
// step big, with the circled control named, its title and instruction, ▶ Hear, ↻ Show me (the
// step's clip loops in the picture) and Edit text; and which Meta models made it. While it is made, the stage list; refused, the V37 words.
import { useState } from 'react';
import { useParams } from 'react-router';
import { MacColumns, MacCrumb } from '../../components/desktop/MacColumns';
import { MacGuideEditDialog } from '../../components/desktop/MacGuideEditDialog';
import { MacGuideOptions } from '../../components/desktop/MacGuideOptions';
import { GuideRefused } from '../../components/GuideRefused';
import { GuideStages } from '../../components/GuideStages';
import { GuideStepMedia } from '../../components/GuideStepMedia';
import { LoadError } from '../../components/LoadError';
import { fromClipLine, GUIDE_COPY, isGuideBusy, stepNav } from '../../core/guides';
import { formatDuration } from '../../core/format';
import { Skeleton } from '../../design/Skeleton';
import { useEditGuideStep, useGuide } from '../../hooks/useGuides';
import { useStepAudio } from '../../hooks/useStepAudio';
import type { Guide, GuideStep } from '../../services/api/types';
import './MacGuidePage.css';

function StepList({ guide, current, onPick }: { guide: Guide; current: number; onPick: (n: number) => void }) {
  return (
    <nav className="mac-guide__steps" aria-label="Steps">
      {guide.steps.map((step) => (
        <button
          key={step.n}
          type="button"
          className={step.n === current ? 'mac-guide__step mac-guide__step--on' : 'mac-guide__step'}
          aria-current={step.n === current ? 'step' : undefined}
          onClick={() => {
            onPick(step.n);
          }}
        >
          <span className="mac-guide__step-thumb">{step.image_url !== null && <img src={step.image_url} alt="" loading="lazy" />}</span>
          <span className="mac-guide__step-text">
            <span className="mac-guide__step-n">{`Step ${String(step.n)}`}</span>
            <span className="mac-guide__step-title">{step.title}</span>
          </span>
        </button>
      ))}
    </nav>
  );
}

const spanText = (step: GuideStep) => `↻ replaying ${formatDuration(step.start_s)}–${formatDuration(step.end_s)} of the clip`;

function BigStep({ step, onEdit }: { step: GuideStep; onEdit: () => void }) {
  const audio = useStepAudio();
  const [isShowing, setShowing] = useState(false);
  const isSpeaking = audio.speaking === step.n;
  return (
    <section className="mac-guide__big" aria-label={`Step ${String(step.n)}`}>
      <GuideStepMedia
        step={step}
        isShowing={isShowing}
        replayingText={spanText(step)}
        circledText={step.highlight === null ? null : `Circled by SAM 3.1: ${step.highlight.label}`}
        className="mac-guide__media"
      />
      <h2 className="mac-guide__title">{step.title}</h2>
      <p className="mac-guide__text">{step.instruction}</p>
      <span className="mac-guide__buttons">
        <button
          type="button"
          className="mac-button mac-button--primary mac-guide__button"
          disabled={step.audio_url === null}
          aria-pressed={isSpeaking}
          onClick={() => {
            if (step.audio_url !== null) audio.toggle(step.n, step.audio_url);
          }}
        >
          {isSpeaking ? GUIDE_COPY.playing : GUIDE_COPY.hear}
        </button>
        <button
          type="button"
          className={isShowing ? 'mac-button mac-button--primary mac-guide__button' : 'mac-button mac-guide__button'}
          disabled={step.clip_url === null}
          aria-pressed={isShowing}
          onClick={() => {
            setShowing(!isShowing);
          }}
        >
          {GUIDE_COPY.showMe}
        </button>
        <button type="button" className="mac-button mac-guide__button" onClick={onEdit}>
          {GUIDE_COPY.editText}
        </button>
      </span>
      <span className="mac-guide__models">{GUIDE_COPY.modelsLine}</span>
    </section>
  );
}

function Ready({ guide, refresh }: { guide: Guide; refresh: () => void }) {
  const [wanted, setWanted] = useState(1);
  const [editing, setEditing] = useState<GuideStep | null>(null);
  const editor = useEditGuideStep(guide.id, refresh);
  const current = stepNav(wanted, guide.steps.length).n;
  const step = guide.steps.find((s) => s.n === current);
  return (
    <div className="mac-guide__columns">
      <StepList guide={guide} current={current} onPick={setWanted} />
      {step !== undefined && (
        <BigStep
          key={step.n}
          step={step}
          onEdit={() => {
            setEditing(step);
          }}
        />
      )}
      <MacGuideEditDialog
        step={editing}
        editor={editor}
        onClose={() => {
          setEditing(null);
        }}
      />
    </div>
  );
}

function Body({ guide, refresh }: { guide: Guide; refresh: () => void }) {
  if (isGuideBusy(guide.status)) {
    return (
      <div className="mac-guide__state" aria-live="polite">
        <span className="mac-guide__state-title">{`Making “${guide.title}”`}</span>
        <GuideStages status={guide.status} stage={guide.stage} />
      </div>
    );
  }
  if (guide.status === 'refused') {
    return (
      <div className="mac-guide__state">
        <GuideRefused reason={guide.safety_reason} linkClass="mac-button mac-button--primary" />
      </div>
    );
  }
  if (guide.status === 'failed') {
    return (
      <div className="mac-guide__state" role="alert">
        <span className="mac-guide__state-title">{GUIDE_COPY.failedTitle}</span>
        <span className="mac-guide__models">{guide.error ?? 'Make it again from the clip.'}</span>
      </div>
    );
  }
  return <Ready guide={guide} refresh={refresh} />;
}

/**
 * The page (`/guides/:id` in the Mac app).
 * @returns The page.
 */
export function MacGuidePage() {
  const { id = '' } = useParams();
  const { state, refresh } = useGuide(id);
  const guide = state.status === 'ready' ? state.data : null;
  return (
    <MacColumns>
      <header className="mac-columns__head mac-columns__head--crumb">
        <MacCrumb to="/guides" label={GUIDE_COPY.guides} />
        <h1 className="mac-columns__crumb-title mac-guide__head-title">{guide?.title ?? ''}</h1>
        {guide !== null && <span className="mac-guide__from">{fromClipLine(guide.clip_title, guide.clip_duration_s)}</span>}
        {guide !== null && !isGuideBusy(guide.status) && <MacGuideOptions guideId={guide.id} />}
      </header>
      {state.status === 'loading' && (
        <div className="mac-guide__state" aria-busy="true">
          <p className="visually-hidden" role="status">
            Loading guide…
          </p>
          <Skeleton kind="video" />
        </div>
      )}
      {state.status === 'error' && <LoadError error={state.error} thing="guide" onRetry={refresh} />}
      {guide !== null && <Body guide={guide} refresh={refresh} />}
    </MacColumns>
  );
}
