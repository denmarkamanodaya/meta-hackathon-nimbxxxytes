// The Ask box (Phase 27 mocks): the 96 px box in the Mac search strip. Two lines of text (it
// scrolls inside), the clips added with +, and a row of + · the intent tag · the scope chip · ⌘K
// · the hold-to-talk mic · send. While the mic is held the text gives way to a wave and a timer;
// while Muse Voice Transcribe works it says so. A document added with + shows as a chip with its
// first page (V47). `MacSearchBar` owns what is typed and the keys.
import { type KeyboardEvent, type MouseEvent, type RefObject } from 'react';
import { LISTENING_LINE, TRANSCRIBING_LINE, waveHeights } from '../../core/ask/voice';
import { formatDuration } from '../../core/format';
import { Icon } from '../../design/Icon';
import { Spinner } from '../../design/Spinner';
import { useNow } from '../../hooks/useNow';
import { useVoiceNote } from '../../hooks/useVoiceNote';
import type { ClipSummary } from '../../services/api/types';
import './MacAskBox.css';

/** Bars in the listening wave and their heights, px (the mock's ripple). */
const WAVE = waveHeights(40, 4, 18);

/** A document added to the request, as its chip shows it. */
export interface DocumentChip {
  id: string;
  title: string;
  /** "1 page"; "" while it is read. */
  pages: string;
  thumbUrl: string | null;
}

/** Props for `MacAskBox`. */
export interface MacAskBoxProps {
  inputRef: RefObject<HTMLTextAreaElement | null>;
  draft: string;
  onDraft: (text: string) => void;
  /** The results popover is open (the field is its combobox). */
  isPopoverOpen: boolean;
  onKeyDown: (event: KeyboardEvent<HTMLTextAreaElement>) => void;
  onFocus: () => void;
  onBlur: () => void;
  /** The clips added to the request. */
  chips: readonly ClipSummary[];
  onRemoveChip: (clipId: string) => void;
  /** The documents added to the request. */
  documents: readonly DocumentChip[];
  onRemoveDocument: (documentId: string) => void;
  isPlusOpen: boolean;
  onPlus: () => void;
  /** What the request was read as ("Short"); null before it is read. */
  tag: string | null;
  scopeLabel: string;
  onScope: (event: MouseEvent<HTMLButtonElement>) => void;
  /** Muse Spark is reading the request. */
  isSending: boolean;
  onSend: () => void;
}

function VoiceTimer({ startedAt }: { startedAt: number }) {
  const now = useNow(250).getTime();
  return <span className="mac-ask__timer">{formatDuration((now - startedAt) / 1000)}</span>;
}

/**
 * The box.
 * @param props - See `MacAskBoxProps`.
 * @returns The box.
 */
export function MacAskBox(props: MacAskBoxProps) {
  const { inputRef, draft, onDraft, chips, tag, isSending } = props;
  const voice = useVoiceNote((text) => {
    const before = draft.trim();
    onDraft(before === '' ? text : `${before} ${text}`);
    requestAnimationFrame(() => {
      inputRef.current?.focus();
    });
  });
  const isRecording = voice.phase === 'starting' || voice.phase === 'recording';
  const isTranscribing = voice.phase === 'transcribing';
  const canSend = draft.trim() !== '' && !isSending && !isRecording && !isTranscribing;
  const onMicKey = (event: KeyboardEvent<HTMLButtonElement>, isDown: boolean) => {
    if (event.key !== ' ' && event.key !== 'Enter') return;
    event.preventDefault();
    if (!isDown) voice.release();
    else if (!event.repeat) voice.press();
  };

  return (
    <div className="mac-ask__box">
      <div className="mac-ask__top">
        {isRecording && (
          <span className="mac-ask__listening" role="status">
            <span className="mac-ask__rec-dot" aria-hidden="true" />
            <span className="mac-ask__wave" aria-hidden="true">
              {WAVE.map((height, index) => (
                <span key={index} className="mac-ask__wave-bar" style={{ height: `${String(height)}px` }} />
              ))}
            </span>
            {voice.startedAt !== null && <VoiceTimer startedAt={voice.startedAt} />}
            <span className="mac-ask__hint">{LISTENING_LINE}</span>
          </span>
        )}
        {isTranscribing && (
          <span className="mac-ask__transcribing" role="status">
            {TRANSCRIBING_LINE}
          </span>
        )}
        <textarea
          ref={inputRef}
          className="mac-ask__input"
          hidden={isRecording || isTranscribing}
          rows={2}
          role="combobox"
          aria-label="iRecall"
          aria-expanded={props.isPopoverOpen}
          aria-controls={props.isPopoverOpen ? 'mac-search-results' : undefined}
          aria-autocomplete="list"
          aria-keyshortcuts="Meta+K"
          placeholder="iRecall: find a moment, make a short, read a letter…"
          value={draft}
          onChange={(event) => {
            onDraft(event.target.value);
          }}
          onFocus={props.onFocus}
          onBlur={props.onBlur}
          onKeyDown={props.onKeyDown}
        />
      </div>
      <div className="mac-ask__row">
        <button
          type="button"
          className="mac-ask__button"
          aria-label="Add clips, a document or upload"
          aria-haspopup="menu"
          aria-expanded={props.isPlusOpen}
          onClick={props.onPlus}
        >
          <Icon name="plus" size="sm" />
        </button>
        {chips.length + props.documents.length > 0 && (
          <ul className="mac-ask__chips" aria-label="Added clips and documents">
            {props.documents.map((doc) => (
              <li key={doc.id} className="mac-ask__chip">
                <span className="mac-ask__chip-thumb mac-ask__chip-thumb--page">{doc.thumbUrl !== null && <img src={doc.thumbUrl} alt="" />}</span>
                <span className="mac-ask__chip-name">{doc.title}</span>
                {doc.pages !== '' && <span className="mac-ask__chip-len">{doc.pages}</span>}
                <button
                  type="button"
                  className="mac-ask__chip-remove"
                  aria-label={`Remove ${doc.title}`}
                  onClick={() => {
                    props.onRemoveDocument(doc.id);
                  }}
                >
                  ×
                </button>
              </li>
            ))}
            {chips.map((clip) => (
              <li key={clip.clip_id} className="mac-ask__chip">
                <span className="mac-ask__chip-thumb">{clip.thumb_url !== null && <img src={clip.thumb_url} alt="" />}</span>
                <span className="mac-ask__chip-name">{clip.title}</span>
                {clip.duration_s !== null && <span className="mac-ask__chip-len">{formatDuration(clip.duration_s)}</span>}
                <button
                  type="button"
                  className="mac-ask__chip-remove"
                  aria-label={`Remove ${clip.title}`}
                  onClick={() => {
                    props.onRemoveChip(clip.clip_id);
                  }}
                >
                  ×
                </button>
              </li>
            ))}
          </ul>
        )}
        {tag !== null && <span className="mac-ask__tag">{tag}</span>}
        {voice.message !== null && (
          <span className="mac-ask__voice-message" role="status">
            {voice.message}
          </span>
        )}
        <span className="mac-ask__grow" />
        <button type="button" className="mac-search__scope" aria-haspopup="menu" aria-label={`Search in: ${props.scopeLabel}`} onClick={props.onScope}>
          {props.scopeLabel}
          <Icon name="chevron-down" size="xs" />
        </button>
        <kbd className="mac-search__kbd">⌘K</kbd>
        <button
          type="button"
          className={isRecording ? 'mac-ask__button mac-ask__mic mac-ask__mic--on' : 'mac-ask__button mac-ask__mic'}
          aria-label={isRecording ? 'Recording: let go to stop' : 'Hold to speak your request'}
          aria-pressed={isRecording}
          disabled={isTranscribing}
          onPointerDown={(event) => {
            if (event.button !== 0) return;
            event.currentTarget.setPointerCapture(event.pointerId);
            voice.press();
          }}
          onPointerUp={voice.release}
          onPointerCancel={voice.release}
          onKeyDown={(event) => {
            onMicKey(event, true);
          }}
          onKeyUp={(event) => {
            onMicKey(event, false);
          }}
        >
          {isRecording ? <span className="mac-ask__stop" aria-hidden="true" /> : <Icon name="mic" size="sm" />}
        </button>
        <button type="button" className="mac-ask__send" aria-label="Send" disabled={!canSend} onClick={props.onSend}>
          {isSending ? <Spinner /> : <Icon name="send" size="sm" />}
        </button>
      </div>
    </div>
  );
}
