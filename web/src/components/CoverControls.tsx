// The cover controls both Publish pages place in their own layout (board V14): the Style chips,
// "Make 3 more · <style>" with its cost line, the Title switch, its text and position, and Redraw
// with words (the field, the suggestion chips, Redraw and its cost line). State lives in
// `useCoverControls`; these only draw it.
import { useId } from 'react';
import { COVER_STYLE_COPY, CUTOUT_COVER_COPY, MUSE_IMAGE_COPY, PRIVACY_COPY, PRODUCTION_COPY, REDRAW_SUGGESTIONS } from '../core/copy';
import { MUSE_COST } from '../core/muse-image';
import { COVER_TITLE_MAX, REDRAW_MAX } from '../core/publish';
import { Icon } from '../design/Icon';
import { Toggle } from '../design/Toggle';
import type { CoverControls } from '../hooks/useCoverControls';
import { CUTOUT_BACKGROUNDS, CUTOUT_STYLE, PICKABLE_COVER_STYLES } from '../services/api/types';
import './CoverControls.css';

/**
 * "Style" and one chip per pickable style.
 * @param props - The controls.
 * @returns The chips.
 */
export function StyleChips({ controls }: { controls: CoverControls }) {
  return (
    <div className="cover-controls__styles" role="group" aria-label={MUSE_IMAGE_COPY.style}>
      <span className="cover-controls__muted">{MUSE_IMAGE_COPY.style}</span>
      {PICKABLE_COVER_STYLES.map((style) => (
        <button
          key={style}
          type="button"
          className={style === controls.style ? 'cover-controls__chip cover-controls__chip--on' : 'cover-controls__chip'}
          aria-pressed={style === controls.style}
          onClick={() => {
            controls.setStyle(style);
          }}
        >
          {COVER_STYLE_COPY[style]}
        </button>
      ))}
      <button
        type="button"
        className={controls.style === CUTOUT_STYLE ? 'cover-controls__chip cover-controls__chip--on' : 'cover-controls__chip'}
        aria-pressed={controls.style === CUTOUT_STYLE}
        onClick={() => {
          controls.setStyle(CUTOUT_STYLE);
        }}
      >
        {COVER_STYLE_COPY.cutout}
        <span className="cover-controls__new">{PRIVACY_COPY.newBadge}</span>
      </button>
    </div>
  );
}

/**
 * "Make 3 more · Bright" and its cost line.
 * @param props - The controls and the class of the button (each page's own button look).
 * @returns The row.
 */
export function MoreCovers({ controls, buttonClass }: { controls: CoverControls; buttonClass: string }) {
  const isCutout = controls.style === CUTOUT_STYLE;
  return (
    <div className="cover-controls__row">
      <button type="button" className={buttonClass} disabled={!controls.canMore} onClick={controls.more}>
        {!isCutout && <Icon name="plus" size="xs" />}
        {isCutout ? CUTOUT_COVER_COPY.make : `${PRODUCTION_COPY.makeMoreCovers} · ${COVER_STYLE_COPY[controls.style]}`}
      </button>
      <span className="cover-controls__cost">{isCutout ? CUTOUT_COVER_COPY.cost : MUSE_COST.moreCovers}</span>
    </div>
  );
}

/**
 * "Background" with Brand scene and Blurred frame, and what each one is (board V21).
 * @param props - The controls.
 * @returns The group.
 */
export function CutoutBackgroundSwitch({ controls }: { controls: CoverControls }) {
  const names = { scene: CUTOUT_COVER_COPY.scene, blur: CUTOUT_COVER_COPY.blur } as const;
  return (
    <div className="cover-controls__group">
      <span className="cover-controls__label">{CUTOUT_COVER_COPY.background}</span>
      <div className="cover-controls__seg" role="radiogroup" aria-label={CUTOUT_COVER_COPY.background}>
        {CUTOUT_BACKGROUNDS.map((background) => (
          <button
            key={background}
            type="button"
            role="radio"
            aria-checked={controls.background === background}
            className={controls.background === background ? 'cover-controls__seg-option cover-controls__seg-option--on' : 'cover-controls__seg-option'}
            onClick={() => {
              controls.setBackground(background);
            }}
          >
            {names[background]}
          </button>
        ))}
      </div>
      <span className="cover-controls__muted">{controls.background === 'scene' ? CUTOUT_COVER_COPY.sceneNote : CUTOUT_COVER_COPY.blurNote}</span>
    </div>
  );
}

/**
 * "How it is made": the three steps of a cutout cover (board V21).
 * @returns The group.
 */
export function HowCutoutIsMade() {
  return (
    <div className="cover-controls__group">
      <span className="cover-controls__label">{CUTOUT_COVER_COPY.howMade}</span>
      {CUTOUT_COVER_COPY.steps.map((step) => (
        <span key={step} className="cover-controls__step">
          {step}
        </span>
      ))}
    </div>
  );
}

/**
 * "TITLE" and the switch that shows it on the cover.
 * @param props - The controls and whether the title is shown.
 * @returns The row.
 */
export function TitleSwitch({ controls, isShown }: { controls: CoverControls; isShown: boolean }) {
  return (
    <div className="cover-controls__row cover-controls__row--apart">
      <span className="cover-controls__label">{MUSE_IMAGE_COPY.title}</span>
      <Toggle checked={isShown} onChange={controls.setShow} label={MUSE_IMAGE_COPY.showTitle} />
    </div>
  );
}

/**
 * The title text field (saved on blur or Enter).
 * @param props - The controls.
 * @returns The field.
 */
export function TitleText({ controls }: { controls: CoverControls }) {
  return (
    <label className="cover-controls__field">
      <span>
        {`${MUSE_IMAGE_COPY.titleText} `}
        <span className="cover-controls__faint">{MUSE_IMAGE_COPY.titleTextNote}</span>
      </span>
      <input
        type="text"
        className="cover-controls__input"
        value={controls.titleText}
        maxLength={COVER_TITLE_MAX * 2}
        onChange={(event) => {
          controls.typeTitle(event.target.value);
        }}
        onBlur={controls.commitTitle}
        onKeyDown={(event) => {
          if (event.key === 'Enter') controls.commitTitle();
        }}
      />
    </label>
  );
}

/**
 * "Position" with Top and Bottom.
 * @param props - The controls and the saved position.
 * @returns The row.
 */
export function TitlePosition({ controls, position }: { controls: CoverControls; position: 'top' | 'bottom' }) {
  const options = [
    { value: 'top', label: MUSE_IMAGE_COPY.top },
    { value: 'bottom', label: MUSE_IMAGE_COPY.bottom },
  ] as const;
  return (
    <div className="cover-controls__row">
      <span className="cover-controls__muted">{MUSE_IMAGE_COPY.position}</span>
      <div className="cover-controls__seg" role="radiogroup" aria-label={MUSE_IMAGE_COPY.titlePosition}>
        {options.map((option) => (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={position === option.value}
            className={position === option.value ? 'cover-controls__seg-option cover-controls__seg-option--on' : 'cover-controls__seg-option'}
            onClick={() => {
              controls.setPosition(option.value);
            }}
          >
            {option.label}
          </button>
        ))}
      </div>
    </div>
  );
}

/**
 * Redraw with words: the field, the suggestion chips, Redraw and its cost line.
 * @param props - The controls and the class of the Redraw button.
 * @returns The block.
 */
export function RedrawWithWords({ controls, buttonClass }: { controls: CoverControls; buttonClass: string }) {
  const id = useId();
  return (
    <div className="cover-controls__redraw">
      <span className="cover-controls__label">{MUSE_IMAGE_COPY.redrawWithWords}</span>
      <label htmlFor={id} className="cover-controls__muted">
        {MUSE_IMAGE_COPY.redrawHelp}
      </label>
      <input
        id={id}
        type="text"
        className="cover-controls__input"
        value={controls.words}
        maxLength={REDRAW_MAX}
        onChange={(event) => {
          controls.setWords(event.target.value);
        }}
        onKeyDown={(event) => {
          if (event.key === 'Enter' && controls.canRedraw) controls.redraw();
        }}
      />
      <div className="cover-controls__suggestions">
        {REDRAW_SUGGESTIONS.map((suggestion) => (
          <button
            key={suggestion}
            type="button"
            className="cover-controls__suggestion"
            onClick={() => {
              controls.suggest(suggestion);
            }}
          >
            {suggestion}
          </button>
        ))}
      </div>
      <div className="cover-controls__row">
        <button type="button" className={buttonClass} disabled={!controls.canRedraw} onClick={controls.redraw}>
          {MUSE_IMAGE_COPY.redraw}
        </button>
        <span className="cover-controls__cost">{MUSE_COST.redrawCover}</span>
      </div>
    </div>
  );
}
