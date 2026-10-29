// The phone step view (`/guides/:id/step/:n`, V35): the guide's name and "Step 3 of 6", one bar
// per step, the step photo (control circled), the step in big type, ▶ Play (the device voice and
// the step's clip together, both started inside the tap; ■ Stop ends both), then big Back and Next
// step (Done on the last; Back on the first returns to the guide, so the full-screen view always
// has a way out). A left or right swipe on the step does the same as Next and Back; the
// buttons are the tap fallback. Changing step stops Play.
import { useEffect, useRef, type PointerEvent } from 'react';
import { useNavigate, useParams } from 'react-router';
import { GuideStepMedia } from '../components/GuideStepMedia';
import { LoadError } from '../components/LoadError';
import { GUIDE_COPY, readStepParam, stepNav, swipeStep } from '../core/guides';
import { Skeleton } from '../design/Skeleton';
import { guidePath, guideStepPath, useGuide } from '../hooks/useGuides';
import { useStepPlay } from '../hooks/useStepPlay';
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
  const player = useStepPlay();
  const start = useRef<{ x: number; y: number } | null>(null);
  const nav = stepNav(wanted, guide.steps.length);
  const { stop } = player;
  // A new step (Back, Next, a swipe or the browser's back) stops what the last one played.
  useEffect(() => stop, [nav.n, stop]);
  const step = guide.steps.find((s) => s.n === nav.n) ?? guide.steps[0];
  if (step === undefined) return <p className="guide-step__muted">This iGuide has no steps.</p>;
  const isPlaying = player.playing === step.n;
  const go = (n: number | null) => {
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
        <GuideStepMedia
          key={step.n}
          step={step}
          isPlaying={isPlaying}
          clipRef={player.bindClip}
          replayingText={GUIDE_COPY.replaying}
          circledText={null}
        />
        <h1 className="guide-step__title">{step.title}</h1>
        <p className="guide-step__text">{step.instruction}</p>
      </div>
      <button
        type="button"
        className="guide-step__play"
        disabled={!player.canPlay(step)}
        aria-pressed={isPlaying}
        onClick={() => {
          player.toggle(step);
        }}
      >
        {isPlaying ? GUIDE_COPY.stop : GUIDE_COPY.play}
      </button>
      <span className="guide-step__grow" />
      <nav className="guide-step__nav" aria-label="Steps">
        <button
          type="button"
          className="guide-step__back"
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
            Loading iGuide…
          </p>
          <Skeleton kind="video" />
          <Skeleton kind="title" />
        </div>
      )}
      {state.status === 'error' && <LoadError error={state.error} thing="iGuide" onRetry={refresh} />}
      {state.status === 'ready' && <StepView guide={state.data} wanted={readStepParam(n)} />}
    </div>
  );
}
