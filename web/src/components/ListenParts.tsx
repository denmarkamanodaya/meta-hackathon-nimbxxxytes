// The pieces of an iListen recording the phone and the Mac pages share (mock
// docs/design/ilisten): the "Summary in" select, the language chips of a row, the Heard bar, the
// Checked card with its versions, the summary and key points, What was said (output language or
// Original, a dot per speaker, a tag per language, "fixed in v2"), the progress list with the check
// loop, and Read it to me in a device voice of the summary's language.
import { useState, type ReactNode } from 'react';
import { languageBoth, languageLabel, OUTPUT_LANGUAGES } from '../core/ilisten/languages';
import {
  colourSlot,
  heardChips,
  ILISTEN_COPY,
  listenStageRows,
  loopLines,
  PASS_SCORE,
  speakerSlots,
  toTarget,
  turnTime,
} from '../core/ilisten/listens';
import { IREAD_COPY } from '../core/iread/documents';
import { Icon } from '../design/Icon';
import { useReadAloudText } from '../hooks/useReadAloudText';
import type { ListenDetail, ListenSummary } from '../services/api/types';
import { StageList } from './GuideStages';
import './ListenParts.css';

/** Props for `LanguageSelect`. */
export interface LanguageSelectProps {
  value: string;
  onChange: (target: string) => void;
  /** Its accessible name ("Summary in"). */
  label: string;
  className: string;
  isDisabled?: boolean;
}

/**
 * The output-language select, each language in its own words.
 * @param props - See `LanguageSelectProps`.
 * @returns The select with its caret.
 */
export function LanguageSelect({ value, onChange, label, className, isDisabled = false }: LanguageSelectProps) {
  return (
    <span className="listen-select">
      <select
        className={`listen-select__field ${className}`}
        aria-label={label}
        value={value}
        disabled={isDisabled}
        onChange={(event) => {
          onChange(event.target.value);
        }}
      >
        {OUTPUT_LANGUAGES.map((language) => (
          <option key={language.code} value={language.code}>
            {language.label}
          </option>
        ))}
      </select>
      <Icon name="chevron-down" size="xs" />
    </span>
  );
}

/**
 * A row's languages: "中文 60%" "日本語 40%" → English, then `facts`; `withShares` false (the phone)
 * drops the shares.
 * @param props - The listen, the facts after the arrow, and whether to show shares.
 * @returns The line.
 */
export function LangChips({ listen, facts, withShares = true }: { listen: ListenSummary; facts: string; withShares?: boolean }) {
  const chips = withShares ? heardChips(listen) : listen.languages.map((each) => languageLabel(each.code));
  return (
    <span className="listen-meta">
      {chips.map((chip) => (
        <span key={chip} className="listen-meta__lang">
          {chip}
        </span>
      ))}
      {chips.length > 0 && <span>{toTarget(listen.target)}</span>}
      {facts !== '' && <span>{chips.length > 0 ? `· ${facts}` : facts}</span>}
    </span>
  );
}

/** A small card with an upper-case heading and, on the right of it, `side`. */
export function ListenCard({ title, side, children }: { title?: string; side?: ReactNode; children: ReactNode }) {
  return (
    <section className="listen-card">
      {title !== undefined && (
        <h3 className="listen-card__head">
          {title}
          {side}
        </h3>
      )}
      {children}
    </section>
  );
}

/**
 * Heard: one bar split by share, and the legend ("中文 Chinese 60%").
 * @param props - The listen.
 * @returns The card; nothing before the languages are known.
 */
export function HeardCard({ listen }: { listen: ListenSummary }) {
  if (listen.languages.length === 0) return null;
  return (
    <ListenCard title={ILISTEN_COPY.heard}>
      <span className="listen-heard__bar" aria-hidden="true">
        {listen.languages.map((each, index) => (
          <span key={each.code} className={`listen-heard__part listen-slot--${String(colourSlot(index))}`} style={{ width: `${String(each.share)}%` }} />
        ))}
      </span>
      <span className="listen-heard__legend">
        {listen.languages.map((each, index) => (
          <span key={each.code}>
            <i className={`listen-dot listen-slot--${String(colourSlot(index))}`} aria-hidden="true" />
            {`${languageBoth(each.code)} ${String(each.share)}%`}
          </span>
        ))}
      </span>
    </ListenCard>
  );
}

/**
 * Checked: the score, what was checked, and each version with its score and notes; a listen that
 * did not pass says it needs a human check.
 * @param props - The listen; `isCompact` (the phone) drops the versions and the long words.
 * @returns The card; nothing before the check.
 */
export function CheckCard({ listen, isCompact = false }: { listen: ListenDetail; isCompact?: boolean }) {
  if (listen.confidence === null) return null;
  const tone = listen.passed ? 'ok' : 'warn';
  const score = <span className={`listen-check__score listen-check__score--${tone}`}>{`${String(listen.confidence)}%`}</span>;
  if (isCompact) {
    return (
      <ListenCard>
        <div className="listen-check">
          {score}
          <span className="listen-check__text">
            <b>{listen.passed ? `${ILISTEN_COPY.checked} · passed on v${String(listen.version)}` : ILISTEN_COPY.needsCheck}</b>
            <br />
            {listen.passed ? 'Every line compared with what was said.' : ILISTEN_COPY.checkNeedsBody}
          </span>
        </div>
      </ListenCard>
    );
  }
  return (
    <ListenCard
      title={ILISTEN_COPY.checked}
      side={<span className={`listen-pill listen-pill--${tone}`}>{listen.passed ? ILISTEN_COPY.passed : ILISTEN_COPY.needsCheck}</span>}
    >
      <div className="listen-check">
        {score}
        <span className="listen-check__text">
          <b>{ILISTEN_COPY.checkBody}</b> {listen.passed ? ILISTEN_COPY.checkHow : ILISTEN_COPY.checkNeedsBody}
        </span>
      </div>
      {listen.versions.length > 0 && (
        <ol className="listen-versions">
          {listen.versions.map((version) => (
            <li key={version.version}>
              <span>{`v${String(version.version)}`}</span>
              <span className={version.passed ? 'listen-versions__good' : 'listen-versions__bad'}>
                {version.confidence === null ? '…' : `${String(version.confidence)}%`}
              </span>
              <span>{version.notes.join('; ')}</span>
            </li>
          ))}
        </ol>
      )}
    </ListenCard>
  );
}

/**
 * The summary and the key points.
 * @param props - The listen, and what sits on the heading's right (the Mac's language select).
 * @returns The card.
 */
export function SummaryCard({ listen, side, isLarge = false }: { listen: ListenDetail; side?: ReactNode; isLarge?: boolean }) {
  return (
    <ListenCard title={side === undefined ? `${ILISTEN_COPY.summary} · ${languageLabel(listen.target)}` : ILISTEN_COPY.summary} side={side}>
      <p className={isLarge ? 'listen-summary listen-summary--large' : 'listen-summary'}>{listen.summary}</p>
      {listen.key_points.length > 0 && (
        <ul className="listen-points">
          {listen.key_points.map((point) => (
            <li key={point}>{point}</li>
          ))}
        </ul>
      )}
    </ListenCard>
  );
}

/** Which words lead each line. */
type Shown = 'target' | 'original';

/**
 * What was said: each line with its speaker's dot, its time and language, "fixed in v2", and the
 * output language with the original under it (or the original alone). A line below the pass score
 * shows the checker's note.
 * @param props - The listen.
 * @returns The card.
 */
export function TranscriptCard({ listen }: { listen: ListenDetail }) {
  const [shown, setShown] = useState<Shown>('target');
  const slots = speakerSlots(listen.turns);
  const toggle = (
    <span className="listen-seg" role="group" aria-label="Show">
      {(['target', 'original'] as const).map((each) => (
        <button
          key={each}
          type="button"
          className={each === shown ? 'listen-seg__option listen-seg__option--on' : 'listen-seg__option'}
          aria-pressed={each === shown}
          onClick={() => {
            setShown(each);
          }}
        >
          {each === 'target' ? languageLabel(listen.target) : ILISTEN_COPY.original}
        </button>
      ))}
    </span>
  );
  return (
    <ListenCard title={ILISTEN_COPY.whatWasSaid} side={toggle}>
      <ol className="listen-turns">
        {listen.turns.map((turn) => {
          const slot = turn.speaker === null ? null : slots.get(turn.speaker);
          const isSame = turn.translation === '' || turn.lang === listen.target;
          const isFlagged = turn.score !== null && turn.score < PASS_SCORE;
          return (
            <li key={turn.index} className={isFlagged ? 'listen-turn listen-turn--flagged' : 'listen-turn'}>
              <span className={`listen-turn__speaker listen-slot--${String(slot ?? 'none')}`} aria-label={turn.speaker === null ? 'Speaker unknown' : `Speaker ${turn.speaker}`}>
                {turn.speaker ?? '?'}
              </span>
              <span className="listen-turn__body">
                <span className="listen-turn__top">
                  <span>{turnTime(turn.start_ms)}</span>
                  {turn.lang !== '' && <span className="listen-turn__tag">{languageLabel(turn.lang)}</span>}
                  {turn.fixed_in > 1 && <span className="listen-turn__fixed">{ILISTEN_COPY.fixedIn(turn.fixed_in)}</span>}
                </span>
                <span className="listen-turn__text">{shown === 'target' && !isSame ? turn.translation : turn.text}</span>
                {shown === 'target' && !isSame && <span className="listen-turn__orig">{turn.text}</span>}
                {isFlagged && turn.issue !== '' && <span className="listen-turn__issue">{`${String(turn.score)}% · ${turn.issue}`}</span>}
              </span>
            </li>
          );
        })}
      </ol>
    </ListenCard>
  );
}

/**
 * While it listens: Audio, Transcribe, Understand and Check with what each found, the check loop
 * under Check ("v1 · 75%", "Fixing the flagged lines", "v2 · checking…"), then Voice.
 * @param props - The listen.
 * @returns The list.
 */
export function ListenProgress({ listen }: { listen: ListenDetail }) {
  const rows = listenStageRows(listen);
  const loop = listen.step === 'check' || listen.step === 'voice' ? loopLines(listen.versions) : [];
  return (
    <div className="listen-progress">
      <StageList rows={rows.slice(0, 4)} />
      {loop.length > 0 && (
        <ol className="listen-loop" aria-label="Check loop">
          {loop.map((line) => (
            <li key={line.head}>
              <b>{line.head}</b>
              {line.body === '' ? '' : ` — ${line.body}`}
            </li>
          ))}
        </ol>
      )}
      <StageList rows={rows.slice(4)} />
    </div>
  );
}

/**
 * Read it to me: the summary in a device voice of its language (the server's English WAV as the
 * fallback); with no voice for that language, the English voice reads it and a line says so.
 * "Stop reading" while it reads.
 * @param props - The listen and the classes of the button and the line under it.
 * @returns The button.
 */
export function ListenReadButton({ listen, className, messageClassName }: { listen: ListenDetail; className: string; messageClassName: string }) {
  const voice = useReadAloudText();
  const [message, setMessage] = useState<string | null>(null);
  const isReading = voice.status !== 'idle';
  const hasOwnVoice = listen.target === 'en' || voice.canSpeakIn(listen.target);
  return (
    <>
      <button
        type="button"
        className={className}
        aria-pressed={isReading}
        onClick={() => {
          if (isReading) {
            voice.stop();
            return;
          }
          const text = [listen.summary, ...listen.key_points].join('\n');
          const started = voice.say(text, listen.summary_audio_url, undefined, hasOwnVoice ? listen.target : undefined);
          setMessage(!started ? IREAD_COPY.noVoice : hasOwnVoice ? null : ILISTEN_COPY.noVoiceFor(languageLabel(listen.target)));
        }}
      >
        <Icon name="speaker" size="md" />
        {isReading ? ILISTEN_COPY.stopReading : ILISTEN_COPY.readToMe}
      </button>
      {message !== null && (
        <p className={messageClassName} role="status">
          {message}
        </p>
      )}
    </>
  );
}
