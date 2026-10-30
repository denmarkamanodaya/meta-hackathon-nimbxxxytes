// iListen on the Mac (mock frame 1), drawn with the iGuide list's rows and right column as iRead
// is: "iListen" with how many recordings; the drop zone (drop a sound file or a video on it, or
// Choose a file, with the "Summary in" select); one row per recording (a wave, the title, the
// languages heard with their shares → the output language, the length and speakers, and the check
// pill). A click selects a row for the right column (the whole recording, or its progress while it
// works); a double click or ⏎ opens it; a right-click opens Rename… / Delete recording…. A failed
// add says why above the list.
import { useState, type DragEvent, type MouseEvent } from 'react';
import { useNavigate } from 'react-router';
import { LangChips, LanguageSelect } from '../../components/ListenParts';
import { LoadError } from '../../components/LoadError';
import { MediaPicker } from '../../components/MediaPicker';
import { ClipPanel } from '../../components/desktop/ClipPanel';
import { MacColumns, MacPill } from '../../components/desktop/MacColumns';
import { MacListenDetail } from '../../components/desktop/MacListenDetail';
import { listenMenuItems, MacListenDialogs, type ListenAsk } from '../../components/desktop/MacListenOptions';
import { ILISTEN_COPY, isListenBusy, listenFacts, listenPill, listenTitle, recordingCount } from '../../core/ilisten/listens';
import { EmptyState } from '../../design/EmptyState';
import { Icon } from '../../design/Icon';
import { Menu } from '../../design/Menu';
import { Skeleton } from '../../design/Skeleton';
import { listenPath, useAddListen, useListen, useListens, useListenTarget } from '../../hooks/useListens';
import { useMenu } from '../../hooks/useMenu';
import type { ListenSummary } from '../../services/api/types';
import '../../components/desktop/MacListenDetail.css';
import './MacGuidesPage.css';
import './MacIReadPage.css';

interface RowProps {
  listen: ListenSummary;
  isSelected: boolean;
  onSelect: () => void;
  onAsk: (ask: ListenAsk) => void;
}

function Row({ listen, isSelected, onSelect, onAsk }: RowProps) {
  const navigate = useNavigate();
  const menu = useMenu();
  const title = listenTitle(listen);
  const pill = listenPill(listen);
  const onContextMenu = (event: MouseEvent<HTMLElement>) => {
    // A recording at work has no actions yet, but the webview's own menu stays away.
    if (isListenBusy(listen.status)) event.preventDefault();
    else menu.openAtPointer(event);
  };
  return (
    <li onContextMenu={onContextMenu}>
      <button
        type="button"
        className={isSelected ? 'mac-guides__row mac-guides__row--on' : 'mac-guides__row'}
        aria-pressed={isSelected}
        onClick={onSelect}
        onDoubleClick={() => {
          void navigate(listenPath(listen.id));
        }}
        onKeyDown={(event) => {
          if (event.key !== 'Enter') return;
          event.preventDefault();
          void navigate(listenPath(listen.id));
        }}
      >
        <span className="mac-guides__thumb mac-listen__wave">
          <Icon name="wave" size="md" />
        </span>
        <span className="mac-guides__text">
          <span className="mac-guides__title">{title}</span>
          <LangChips listen={listen} facts={listenFacts(listen)} />
        </span>
        <MacPill tone={pill.tone}>{pill.label}</MacPill>
      </button>
      <Menu anchor={menu.anchor} label={title} onClose={menu.close} className="mac-menu--narrow" items={listenMenuItems({ listenId: listen.id, title }, onAsk)} />
    </li>
  );
}

/** The right column for the selected recording, read in full. */
function Selected({ summary }: { summary: ListenSummary }) {
  const { state, refresh } = useListen(summary.id);
  return (
    <ClipPanel>
      <div className="mac-guides__aside">
        {state.status === 'ready' ? <MacListenDetail listen={state.data} refresh={refresh} /> : <Skeleton kind="line" />}
      </div>
    </ClipPanel>
  );
}

/** The drop zone: a file dropped on it, or picked with Choose a file, is listened to in `target`. */
function DropZone({ onFile, isAdding }: { onFile: (file: File, target: string) => void; isAdding: boolean }) {
  const { target, setTarget } = useListenTarget();
  const [isOver, setOver] = useState(false);
  const onDrop = (event: DragEvent<HTMLElement>) => {
    event.preventDefault();
    setOver(false);
    const file = event.dataTransfer.files[0];
    if (file !== undefined && !isAdding) onFile(file, target);
  };
  return (
    <section
      className={isOver ? 'mac-listen-drop mac-listen-drop--over' : 'mac-listen-drop'}
      aria-label={ILISTEN_COPY.dropTitle}
      onDragOver={(event) => {
        // Only files: a Gallery clip dragged over here is not taken.
        if (!event.dataTransfer.types.includes('Files')) return;
        event.preventDefault();
        setOver(true);
      }}
      onDragLeave={() => {
        setOver(false);
      }}
      onDrop={onDrop}
    >
      <Icon name="wave" size="md" />
      <span className="mac-listen-drop__text">
        <b>{isOver ? ILISTEN_COPY.dropHere : ILISTEN_COPY.dropTitle}</b>
        <small>{ILISTEN_COPY.dropBody}</small>
      </span>
      <span className="mac-listen-drop__field">
        <small>{ILISTEN_COPY.summaryIn}</small>
        <LanguageSelect value={target} onChange={setTarget} label={ILISTEN_COPY.summaryIn} className="mac-listen__select" isDisabled={isAdding} />
      </span>
      <MediaPicker
        className="mac-button mac-button--primary"
        isDisabled={isAdding}
        onFile={(file) => {
          onFile(file, target);
        }}
      >
        {isAdding ? ILISTEN_COPY.uploading : ILISTEN_COPY.chooseFile}
      </MediaPicker>
    </section>
  );
}

/**
 * The page (`/ilisten` in the Mac app).
 * @returns The page.
 */
export function MacIListenPage() {
  const { state, refresh } = useListens();
  const { add, isAdding, error } = useAddListen();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [ask, setAsk] = useState<ListenAsk>(null);
  const rows = state.status === 'ready' ? state.data : [];
  const selected = rows.find((row) => row.id === selectedId) ?? rows[0];
  const onFile = (file: File, target: string) => {
    void add(file, target).then((id) => {
      if (id === null) return;
      refresh();
      setSelectedId(id);
    });
  };
  return (
    <MacColumns asideLabel="Selected recording" aside={selected === undefined ? undefined : <Selected key={selected.id} summary={selected} />}>
      <header className="mac-columns__head">
        <h1 className="mac-columns__title">{ILISTEN_COPY.section}</h1>
        {state.status === 'ready' && rows.length > 0 && <span className="mac-columns__sub">{recordingCount(rows.length)}</span>}
      </header>
      <DropZone onFile={onFile} isAdding={isAdding} />
      {error !== null && (
        <p className="mac-guides__muted mac-iread__error" role="alert">
          {`${ILISTEN_COPY.addFailed}: ${error}`}
        </p>
      )}
      {state.status === 'loading' && (
        <div className="mac-guides__list" aria-busy="true">
          <p className="visually-hidden" role="status">
            Loading your recordings…
          </p>
          <Skeleton kind="line" />
          <Skeleton kind="line" />
        </div>
      )}
      {state.status === 'error' && <LoadError error={state.error} thing="recordings" onRetry={refresh} />}
      {state.status === 'ready' && rows.length === 0 && <EmptyState icon="wave" title={ILISTEN_COPY.emptyTitle} body={ILISTEN_COPY.emptyBody} />}
      {rows.length > 0 && (
        <ul className="mac-guides__list">
          {rows.map((listen) => (
            <Row
              key={listen.id}
              listen={listen}
              isSelected={listen.id === selected?.id}
              onSelect={() => {
                setSelectedId(listen.id);
              }}
              onAsk={setAsk}
            />
          ))}
        </ul>
      )}
      <MacListenDialogs
        ask={ask}
        onClose={() => {
          setAsk(null);
        }}
        onRenamed={refresh}
        onDeleted={refresh}
      />
    </MacColumns>
  );
}
