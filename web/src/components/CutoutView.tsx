// The Cut out dialog's content (board V22), placed in a Mac dialog or a PWA sheet: "Cut out · dog",
// where it is from, the cut-out on a checkerboard, the Sticker switch (shows the outlined PNG),
// the cost and a hint, then Copy and Download PNG.
import { useState, type ReactNode } from 'react';
import { CUTOUT_COPY } from '../core/copy';
import { formatDuration } from '../core/format';
import { Toggle } from '../design/Toggle';
import { useCopyCutout } from '../hooks/useObjectPick';
import type { CutoutResponse } from '../services/api/types';
import './CutoutView.css';

/** Props for `CutoutView`. */
export interface CutoutViewProps {
  cutout: CutoutResponse;
  /** The second it was cut from. */
  atS: number;
  /** The heading's close button (the Mac dialog); the PWA sheet has its own. */
  close?: ReactNode;
  /** Shows "Cut out · dog" in the heading; false where the container already titles it (the PWA sheet). */
  hasTitle?: boolean;
  /** Button classes of the platform: the secondary and the primary look. */
  buttonClass: string;
  primaryClass: string;
}

/** "Cut out · dog". */
export const cutoutTitle = (label: string): string => `${CUTOUT_COPY.title} · ${label}`;

/**
 * The content.
 * @param props - See `CutoutViewProps`.
 * @returns The content.
 */
export function CutoutView({ cutout, atS, close, hasTitle = true, buttonClass, primaryClass }: CutoutViewProps) {
  const [isSticker, setSticker] = useState(false);
  const copy = useCopyCutout();
  const url = isSticker ? cutout.sticker_url : cutout.png_url;
  const filename = `nimbytes-${cutout.label.replace(/\s+/g, '-')}${isSticker ? '-sticker' : ''}.png`;
  return (
    <div className="cutout">
      <div className="cutout__head">
        <span className="cutout__heading">
          {hasTitle && <span className="cutout__title">{cutoutTitle(cutout.label)}</span>}
          <span className="cutout__muted">{`From ${formatDuration(atS)} · cut out by SAM 3.1`}</span>
        </span>
        {close}
      </div>
      <div className="cutout__body">
        <span className="cutout__checker">
          <img className="cutout__image" src={url} alt={cutout.label} />
        </span>
        <div className="cutout__side">
          <div className="cutout__switch">
            <span className="cutout__heading">
              <span className="cutout__switch-title">{CUTOUT_COPY.sticker}</span>
              <span className="cutout__muted">{CUTOUT_COPY.stickerHint}</span>
            </span>
            <Toggle checked={isSticker} onChange={setSticker} label={CUTOUT_COPY.sticker} />
          </div>
          <span className="cutout__muted">{CUTOUT_COPY.cost}</span>
          <span className="cutout__muted">{CUTOUT_COPY.wrongThing}</span>
        </div>
      </div>
      <div className="cutout__foot">
        <button
          type="button"
          className={buttonClass}
          onClick={() => {
            void copy(url);
          }}
        >
          {CUTOUT_COPY.copy}
        </button>
        <a className={primaryClass} href={url} download={filename}>
          {CUTOUT_COPY.download}
        </a>
      </div>
    </div>
  );
}
