// A guide step's picture (V34 big step, V35 phone step): the step photo with the control already
// circled by the server, the step number, and while ▶ Play runs, the step's own short clip playing
// once over the photo (muted; the voice plays beside it) with a "replaying" note.
import type { Ref } from 'react';
import type { GuideStep } from '../services/api/types';
import './GuideStepMedia.css';

/** Props for `GuideStepMedia`. */
export interface GuideStepMediaProps {
  step: GuideStep;
  /** Play is on: the clip shows over the photo. */
  isPlaying: boolean;
  /** The clip's element, which Play starts from the tap; absent, no clip is loaded (a preview). */
  clipRef?: Ref<HTMLVideoElement>;
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
export function GuideStepMedia({ step, isPlaying, clipRef, replayingText, circledText, className }: GuideStepMediaProps) {
  const isClipShown = isPlaying && step.clip_url !== null;
  const alt = step.highlight === null ? `Step ${String(step.n)}: ${step.title}` : `Step ${String(step.n)}: ${step.title}, the ${step.highlight.label} circled`;
  return (
    <figure className={className === undefined ? 'guide-media' : `guide-media ${className}`}>
      {step.image_url !== null && <img className="guide-media__image" src={step.image_url} alt={alt} />}
      {clipRef !== undefined && step.clip_url !== null && (
        <video
          ref={clipRef}
          className={isClipShown ? 'guide-media__clip' : 'guide-media__clip guide-media__clip--off'}
          src={step.clip_url}
          {...(step.image_url === null ? {} : { poster: step.image_url })}
          muted
          playsInline
          preload="metadata"
          aria-hidden={!isClipShown}
          aria-label={`Step ${String(step.n)} replaying`}
        />
      )}
      <span className="guide-media__number" aria-hidden="true">
        {step.n}
      </span>
      {isClipShown && <span className="guide-media__note guide-media__note--replay">{replayingText}</span>}
      {circledText !== null && <span className="guide-media__note guide-media__note--circled">{circledText}</span>}
    </figure>
  );
}
