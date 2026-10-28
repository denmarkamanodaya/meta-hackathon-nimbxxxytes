// A guide step's picture (V34 big step, V35 phone step): the step photo with the control already
// circled by the server, the step number, and while Show me is on, the step's own short clip
// looping in its place (muted; ▶ Hear plays the voice) with a "replaying" note.
import type { GuideStep } from '../services/api/types';
import './GuideStepMedia.css';

/** Props for `GuideStepMedia`. */
export interface GuideStepMediaProps {
  step: GuideStep;
  /** Show me is on: loop `clip_url` over the photo. */
  isShowing: boolean;
  /** The note while replaying ("↻ Replaying this step"). */
  replayingText: string;
  /** Mac only: "Circled by SAM 3.1: dial" in the corner; null leaves it out. */
  circledText: string | null;
  /** Page-specific size class (the Mac's bigger number). */
  className?: string;
}

/**
 * The picture.
 * @param props - See `GuideStepMediaProps`.
 * @returns The figure.
 */
export function GuideStepMedia({ step, isShowing, replayingText, circledText, className }: GuideStepMediaProps) {
  const isLooping = isShowing && step.clip_url !== null;
  const alt = step.highlight === null ? `Step ${String(step.n)}: ${step.title}` : `Step ${String(step.n)}: ${step.title}, the ${step.highlight.label} circled`;
  return (
    <figure className={className === undefined ? 'guide-media' : `guide-media ${className}`}>
      {step.image_url !== null && <img className="guide-media__image" src={step.image_url} alt={alt} />}
      {isLooping && step.clip_url !== null && (
        <video
          className="guide-media__clip"
          src={step.clip_url}
          {...(step.image_url === null ? {} : { poster: step.image_url })}
          autoPlay
          loop
          muted
          playsInline
          aria-label={`Step ${String(step.n)} replaying`}
        />
      )}
      <span className="guide-media__number" aria-hidden="true">
        {step.n}
      </span>
      {isLooping && <span className="guide-media__note guide-media__note--replay">{replayingText}</span>}
      {circledText !== null && <span className="guide-media__note guide-media__note--circled">{circledText}</span>}
    </figure>
  );
}
