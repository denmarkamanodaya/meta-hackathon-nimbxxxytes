// The phone step view (`/guides/:id/step/:n`, V35): the guide's name and "Step 3 of 6", one bar
// per step, the step photo (control circled), the step in big type, ▶ Hear (the server's voice in
// an <audio> element, started inside the tap) and ↻ Show me (the step's clip looping), then big
// Back and Next step (Done on the last). A left or right swipe on the step does the same as Next
// and Back; the buttons are the tap fallback.
import { useRef, useState, type PointerEvent } from 'react';
import { useNavigate, useParams } from 'react-router';
import { GuideStepMedia } from '../components/GuideStepMedia';
import { LoadError } from '../components/LoadError';
import { GUIDE_COPY, readStepParam, stepNav, swipeStep } from '../core/guides';
import { Skeleton } from '../design/Skeleton';
import { guidePath, guideStepPath, useGuide } from '../hooks/useGuides';
import { useStepAudio } from '../hooks/useStepAudio';
import type { Guide } from '../services/api/types';
import './GuideStepPage.css';

function Dots({ count, at }: { count: number; at: number }) {
  return (
    <span className="guide-step__dots" aria-hidden="true">
      {Array.from({ length: count }, (_, index) => (
        <span key={index} className={index < at ? 'guide-step__dot guide-step__dot--on' : 'guide-step__dot'} />
      ))}
    </span>
  );
}

function StepView({ guide, wanted }: { guide: Guide; wanted: number }) {
  const navigate = useNavigate();
  const audio = useStepAudio();
  const [showingStep, setShowingStep] = useState<number | null>(null);
  const start = useRef<{ x: number; y: number } | null>(null);
  const nav = stepNav(wanted, guide.steps.length);
  const step = guide.steps.find((s) => s.n === nav.n) ?? guide.steps[0];
  if (step === undefined) return <p className="guide-step__muted">This guide has no steps.</p>;
  const isShowing = showingStep === step.n;
  const go = (n: number | null) => {
    audio.stop();
    setShowingStep(null);
    void navigate(n === null ? guidePath(guide.id) : guideStepPath(guide.id, n), { replace: true });
  };
  const onPointerUp = (event: PointerEvent) => {
    const from = start.current;
    start.current = null;
    if (from === null) return;
    const move = swipeStep(event.clientX - from.x, event.clientY - from.y);
    if (move === 'next' && nav.next !== null) go(nav.next);
    if (move === 'prev' && nav.prev !== null) go(nav.prev);
  };
  return (
    <>
      <header className="guide-step__head">
        <span className="guide-step__row">
          <span className="guide-step__guide">{guide.title}</span>
          <span className="guide-step__count">{nav.label}</span>
        </span>
        <Dots count={guide.steps.length} at={nav.n} />
      </header>
      <div
        className="guide-step__swipe"
        onPointerDown={(event) => {
          start.current = { x: event.clientX, y: event.clientY };
        }}
        onPointerUp={onPointerUp}
        onPointerCancel={() => {
          start.current = null;
        }}
      >
        <GuideStepMedia step={step} isShowing={isShowing} replayingText={GUIDE_COPY.replaying} circledText={null} />
        <h1 className="guide-step__title">{step.title}</h1>
        <p className="guide-step__text">{step.instruction}</p>
      </div>
      <div className="guide-step__pair">
        <button
          type="button"
          className="guide-step__hear"
          disabled={step.audio_url === null}
          aria-pressed={audio.speaking === step.n}
          onClick={() => {
            if (step.audio_url !== null) audio.toggle(step.n, step.audio_url);
          }}
        >
          {audio.speaking === step.n ? GUIDE_COPY.speaking : GUIDE_COPY.hear}
        </button>
        <button
          type="button"
          className="guide-step__show"
          disabled={step.clip_url === null}
          aria-pressed={isShowing}
          onClick={() => {
            setShowingStep(isShowing ? null : step.n);
          }}
        >
          {GUIDE_COPY.showMe}
        </button>
      </div>
      <span className="guide-step__grow" />
      <nav className="guide-step__nav" aria-label="Steps">
        <button
          type="button"
          className="guide-step__back"
          disabled={nav.prev === null}
          onClick={() => {
            go(nav.prev);
          }}
        >
          {GUIDE_COPY.back}
        </button>
        <button
          type="button"
          className="guide-step__next"
          onClick={() => {
            go(nav.next);
          }}
        >
          {nav.next === null ? GUIDE_COPY.done : GUIDE_COPY.nextStep}
        </button>
      </nav>
    </>
  );
}

/**
 * The page.
 * @returns One step of the guide in the route.
 */
export function GuideStepPage() {
  const { id = '', n } = useParams();
  const { state, refresh } = useGuide(id);
  return (
    <div className="guide-step">
      {state.status === 'loading' && (
        <div aria-busy="true">
          <p className="visually-hidden" role="status">
            Loading guide…
          </p>
          <Skeleton kind="video" />
          <Skeleton kind="title" />
        </div>
      )}
      {state.status === 'error' && <LoadError error={state.error} thing="guide" onRetry={refresh} />}
      {state.status === 'ready' && <StepView guide={state.data} wanted={readStepParam(n)} />}
    </div>
  );
}
