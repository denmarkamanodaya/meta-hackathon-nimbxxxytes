// A recording on the Mac (mock frames 1 and 2), the same in the iListen list's right column and on
// the recording's own page: the title and "mix.wav · 0:26 · 2 speakers · 30 Oct"; when done, Heard,
// Checked with its versions, the summary with its "Summary in" select (a new pick writes it again,
// the transcript stays), Read it to me and Ask about it… (the summary goes into the Ask box), then
// the player with What was said (tap a line to play from there). While it works, the progress list with the check loop and the leave note.
import { CheckCard, HeardCard, LanguageSelect, ListenPlayback, ListenProgress, ListenReadButton, SummaryCard } from '../ListenParts';
import { formatShortDate } from '../../core/format';
import { ILISTEN_COPY, isListenBusy, listenSubLine, listenTitle } from '../../core/ilisten/listens';
import { languageLabel } from '../../core/ilisten/languages';
import { useChangeListenLanguage } from '../../hooks/useListens';
import { useFocusSearch } from '../../hooks/useSearchBar';
import type { ListenDetail } from '../../services/api/types';
import './MacListenDetail.css';

/**
 * The words the Ask box gets for "Ask about it…": the recording's title and summary, then room for
 * the question.
 * @param listen - The recording.
 * @returns The draft.
 */
export const askDraft = (listen: Pick<ListenDetail, 'title' | 'summary' | 'source_name' | 'status'>): string =>
  `About my recording “${listenTitle(listen)}”: ${listen.summary} — `;

function Done({ listen, refresh }: { listen: ListenDetail; refresh: () => void }) {
  const { change, isChanging } = useChangeListenLanguage(refresh);
  const focusAsk = useFocusSearch();
  return (
    <>
      <HeardCard listen={listen} />
      <CheckCard listen={listen} />
      <SummaryCard
        listen={listen}
        side={
          <LanguageSelect
            value={listen.target}
            label={ILISTEN_COPY.summaryIn}
            className="mac-listen__select"
            isDisabled={isChanging}
            onChange={(target) => {
              if (target !== listen.target) void change(listen.id, target);
            }}
          />
        }
      />
      <span className="mac-listen__actions">
        <ListenReadButton listen={listen} className="mac-button mac-button--primary" messageClassName="mac-listen__muted" />
        <button
          type="button"
          className="mac-button"
          onClick={() => {
            focusAsk(askDraft(listen));
          }}
        >
          {ILISTEN_COPY.askAbout}
        </button>
      </span>
      <ListenPlayback listen={listen} />
    </>
  );
}

/**
 * The detail.
 * @param props - The recording, what reloads it, and whether the title shows (the right column).
 * @returns The column's content.
 */
export function MacListenDetail({ listen, refresh, withTitle = true }: { listen: ListenDetail; refresh: () => void; withTitle?: boolean }) {
  const sub = [listenSubLine(listen), formatShortDate(listen.created_at, new Date())].filter((part) => part !== '').join(' · ');
  return (
    <div className="mac-listen">
      {withTitle && <h2 className="mac-listen__title">{listenTitle(listen)}</h2>}
      <span className="mac-listen__muted">{isListenBusy(listen.status) ? `${sub} · Summary in ${languageLabel(listen.target)}` : sub}</span>
      {isListenBusy(listen.status) && (
        <>
          <div className="listen-card">
            <ListenProgress listen={listen} />
          </div>
          <span className="mac-listen__muted">{ILISTEN_COPY.leaveNote}</span>
        </>
      )}
      {listen.status === 'failed' && <span className="mac-listen__muted">{listen.error ?? ILISTEN_COPY.failedBody}</span>}
      {listen.status === 'ready' && <Done listen={listen} refresh={refresh} />}
    </div>
  );
}
