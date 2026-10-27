// The right column for one clip (redesign v2), as parts each page composes into exactly its mock:
// the Gallery (V1/V2) stacks the header (preview, title, meta, where the clip is), the tabs and a
// footer with Make a short, the offline switch row and Add to project / Show in Finder / More; the
// player page (V3) stacks the tabs and a footer with Make a short over the offline button and Add
// to project. `GalleryClipPanel` is the Gallery's composition.
import { useState, type ReactNode } from 'react';
import { Link, useNavigate } from 'react-router';
import { NAV_COPY } from '../../core/copy';
import { formatBytes, formatDuration } from '../../core/format';
import { availabilityLine, panelMetaLine } from '../../core/gallery';
import { clipAvailability } from '../../core/on-this-mac';
import { visibleTracks } from '../../core/clip-view';
import { handoffFromClip } from '../../core/selection';
import { Icon } from '../../design/Icon';
import { Menu, type MenuEntry } from '../../design/Menu';
import { SegmentedTabs } from '../../design/SegmentedTabs';
import { Toggle } from '../../design/Toggle';
import { useClip, useMakeShortFromClip } from '../../hooks/useClips';
import { useClipOffline, useRevealClip, useSyncStatus } from '../../hooks/useDesktop';
import { useMenu } from '../../hooks/useMenu';
import { useNow } from '../../hooks/useNow';
import { useProjectActions, useProjects } from '../../hooks/useProjects';
import type { ClipDetail, ClipSummary, Segment, Track, Turn } from '../../services/api/types';
import { ClipDeleteSheet, type DeleteTarget } from '../ClipDeleteSheet';
import { AvailabilityIcon } from './AvailabilityIcon';
import { NewProjectSheet } from './NewProjectSheet';
import { addToProjectItems } from './project-menu';
import './MacColumns.css';
import './ClipPanel.css';

/** The three tabs. */
export type ClipPanelTab = 'moments' | 'speech' | 'faces';

/** How many faces the Faces tab shows before "+N". */
const FACE_CARDS = 7;

/** How often the release countdown redraws. */
const TICK_MS = 1000;

/**
 * The column's frame: its parts stacked, the tabs taking the free height.
 * @param props - The parts.
 * @returns The frame.
 */
export function ClipPanel({ children }: { children: ReactNode }) {
  return <div className="clip-panel">{children}</div>;
}

function Where({ clipId }: { clipId: string }) {
  const { state } = useSyncStatus();
  const now = useNow(TICK_MS);
  const sync = state.status === 'ready' ? state.data : null;
  const availability = clipAvailability(clipId, sync);
  const line = availabilityLine(
    { availability, drive: sync?.local.clips.find((row) => row.clipId === clipId), releaseAfterS: sync?.releaseAfterS ?? null },
    now,
  );
  return (
    <p className="clip-panel__where">
      <AvailabilityIcon state={availability} size="bare" />
      {line}
    </p>
  );
}

/**
 * The Gallery's head: a 16:9 preview that opens the clip, the title, "19 Aug 2026 · 5:27 · 3.4 GB ·
 * in 60th birthday", and where the clip is on this Mac.
 * @param props - The clip.
 * @returns The head.
 */
export function ClipPanelHeader({ clip }: { clip: ClipSummary }) {
  const { state } = useProjects();
  return (
    <div className="clip-panel__head">
      <Link className="clip-panel__preview" to={`/clips/${encodeURIComponent(clip.clip_id)}`} aria-label={`Play ${clip.title}`}>
        {clip.thumb_url !== null && <img className="clip-panel__img" src={clip.thumb_url} alt="" />}
        <span className="clip-panel__play" aria-hidden="true">
          <Icon name="play" size="sm" />
        </span>
        {clip.duration_s !== null && <span className="clip-panel__duration">{formatDuration(clip.duration_s)}</span>}
      </Link>
      <div>
        <h2 className="clip-panel__title">{clip.title}</h2>
        <p className="clip-panel__meta">{panelMetaLine(clip, state.status === 'ready' ? state.data : [])}</p>
      </div>
      <Where clipId={clip.clip_id} />
    </div>
  );
}

function Lines({ rows, onSeek, isQuoted }: { rows: readonly (Segment | Turn)[]; onSeek: (s: number) => void; isQuoted: boolean }) {
  return (
    <ul className="clip-panel__lines">
      {rows.map((row) => {
        const text = 'text' in row ? row.text : (row.description ?? '');
        return (
          <li key={'turn_id' in row ? row.turn_id : row.segment_id}>
            <button
              type="button"
              className="clip-panel__line"
              onClick={() => {
                onSeek(row.start_s);
              }}
            >
              <span className="clip-panel__time">{formatDuration(row.start_s)}</span>
              <span className="clip-panel__text">{isQuoted ? `“${text}”` : text}</span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}

function Faces({ tracks }: { tracks: readonly Track[] }) {
  const shown = tracks.length > FACE_CARDS + 1 ? tracks.slice(0, FACE_CARDS) : tracks;
  const more = tracks.length - shown.length;
  return (
    <div className="clip-panel__faces">
      <div className="clip-panel__face-grid">
        {shown.map((track) => (
          <Link key={track.track_id} className="clip-panel__face" to="/people">
            <span className="clip-panel__face-crop">
              {track.crop_url === null ? <Icon name="person" size="md" /> : <img src={track.crop_url} alt="" />}
            </span>
            <span>{track.person_name ?? 'Name?'}</span>
          </Link>
        ))}
        {more > 0 && (
          <Link className="clip-panel__face" to="/people">
            <span className="clip-panel__face-crop">
              <Icon name="person" size="md" />
            </span>
            <span>{`+${String(more)}`}</span>
          </Link>
        )}
      </div>
      <Link className="clip-panel__all-faces" to="/people">
        {`All ${String(tracks.length)} faces in ${NAV_COPY.faces}`}
      </Link>
    </div>
  );
}

function TabBody({ tab, detail, onSeek, speech }: { tab: ClipPanelTab; detail: ClipDetail | null; onSeek: (s: number) => void; speech: ReactNode }) {
  if (detail === null) return <p className="clip-panel__empty">Loading…</p>;
  if (tab === 'speech' && speech !== undefined && speech !== null) return speech;
  if (tab === 'moments') {
    return detail.segments.length === 0 ? <p className="clip-panel__empty">No moments yet.</p> : <Lines rows={detail.segments} onSeek={onSeek} isQuoted={false} />;
  }
  if (tab === 'speech') {
    return detail.turns.length === 0 ? <p className="clip-panel__empty">Nobody speaks in this clip.</p> : <Lines rows={detail.turns} onSeek={onSeek} isQuoted />;
  }
  const tracks = visibleTracks(detail.tracks);
  return tracks.length === 0 ? <p className="clip-panel__empty">No faces in this clip.</p> : <Faces tracks={tracks} />;
}

/** Props for `ClipPanelTabs`. */
export interface ClipPanelTabsProps {
  clip: ClipSummary;
  /** The clip's detail; null while it loads. */
  detail: ClipDetail | null;
  /** The tab it opens on. */
  defaultTab?: ClipPanelTab;
  /** A moment or speech line was picked; absent, the clip opens at that second. */
  onSeek?: (seconds: number) => void;
  /** Replaces the Speech tab's list (the player page's list that follows playback). */
  speech?: ReactNode;
}

/**
 * Moments / Speech / Faces with their counts (the chosen tab in accent with a 2 px underline) and
 * the chosen list.
 * @param props - See `ClipPanelTabsProps`.
 * @returns The tabs and their panel.
 */
export function ClipPanelTabs({ clip, detail, defaultTab = 'moments', onSeek, speech }: ClipPanelTabsProps) {
  const navigate = useNavigate();
  const [tab, setTab] = useState<ClipPanelTab>(defaultTab);
  const seek =
    onSeek ??
    ((seconds: number) => {
      void navigate(`/clips/${encodeURIComponent(clip.clip_id)}?t=${String(Math.floor(seconds))}`);
    });
  const panelId = `clip-panel-${clip.clip_id}`;
  return (
    <>
      <SegmentedTabs
        look="underline"
        label="Clip details"
        panelId={panelId}
        value={tab}
        onChange={setTab}
        options={[
          { value: 'moments', label: NAV_COPY.moments, count: clip.segment_count },
          { value: 'speech', label: NAV_COPY.speech, count: clip.speech_count },
          { value: 'faces', label: NAV_COPY.faces, count: clip.face_count },
        ]}
      />
      <div className="clip-panel__body" id={panelId} role="tabpanel">
        <TabBody tab={tab} detail={detail} onSeek={seek} speech={speech} />
      </div>
    </>
  );
}

/**
 * The footer under the tabs: a line above, the actions stacked.
 * @param props - The actions.
 * @returns The footer.
 */
export function ClipPanelFooter({ children }: { children: ReactNode }) {
  return <div className="clip-panel__actions">{children}</div>;
}

/**
 * A row of equal buttons in the footer.
 * @param props - The buttons.
 * @returns The row.
 */
export function ClipPanelButtons({ children }: { children: ReactNode }) {
  return <div className="clip-panel__buttons">{children}</div>;
}

/**
 * "Make a short" (the 32 px accent button): every moment of the clip to the editor.
 * @param props - The clip, its detail when loaded (else it is loaded on press), and the label.
 * @returns The button.
 */
export function MakeShortButton({ clip, detail, children }: { clip: ClipSummary; detail: ClipDetail | null; children: ReactNode }) {
  const navigate = useNavigate();
  const makeShortById = useMakeShortFromClip();
  return (
    <button
      type="button"
      className="mac-button mac-button--primary"
      disabled={clip.status !== 'ready' || clip.segment_count === 0}
      onClick={() => {
        if (detail === null) makeShortById(clip.clip_id);
        else void navigate('/editor', { state: handoffFromClip(detail) });
      }}
    >
      {children}
    </button>
  );
}

/**
 * The Gallery's offline row: "Make available offline", "Keeps all 3.4 GB on this Mac" and a switch.
 * @param props - The clip.
 * @returns The row.
 */
export function OfflineSwitchRow({ clip }: { clip: ClipSummary }) {
  const offline = useClipOffline(clip.clip_id);
  return (
    <div className="clip-panel__offline">
      <span className="clip-panel__offline-text">
        <span className="clip-panel__offline-title">Make available offline</span>
        <span className="clip-panel__offline-line">{`Keeps all ${formatBytes(clip.size_bytes)} on this Mac`}</span>
      </span>
      <Toggle
        label="Make available offline"
        checked={offline.isPinned === true}
        disabled={clip.status !== 'ready' || offline.isPinned === null || offline.isSaving}
        onChange={(next) => {
          void offline.setPinned(next);
        }}
      />
    </div>
  );
}

/**
 * The player's offline button: "Make available offline", pressed while the clip is kept.
 * @param props - The clip.
 * @returns The button.
 */
export function OfflineButton({ clip }: { clip: ClipSummary }) {
  const offline = useClipOffline(clip.clip_id);
  return (
    <button
      type="button"
      className="mac-button clip-panel__grow"
      aria-pressed={offline.isPinned === true}
      disabled={clip.status !== 'ready' || offline.isPinned === null || offline.isSaving}
      onClick={() => {
        void offline.setPinned(offline.isPinned !== true);
      }}
    >
      Make available offline
    </button>
  );
}

/**
 * "Add to project": the project list with checks, and New project….
 * @param props - The clip and the button's content.
 * @returns The button, its menu and the New project sheet.
 */
export function AddToProjectButton({ clip, children }: { clip: ClipSummary; children: ReactNode }) {
  const { state } = useProjects();
  const { toggle } = useProjectActions();
  const menu = useMenu();
  const [isNewOpen, setNewOpen] = useState(false);
  return (
    <>
      <button type="button" className="mac-button clip-panel__grow" aria-haspopup="menu" onClick={menu.openFromButton}>
        {children}
      </button>
      <Menu
        anchor={menu.anchor}
        label="Add to project"
        onClose={menu.close}
        items={addToProjectItems(state.status === 'ready' ? state.data : [], [clip], toggle, () => {
          setNewOpen(true);
        })}
      />
      <NewProjectSheet
        open={isNewOpen}
        clipIds={[clip.clip_id]}
        onClose={() => {
          setNewOpen(false);
        }}
      />
    </>
  );
}

/**
 * "Show in Finder": reveals the clip's original in `~/nimbytes`.
 * @param props - The clip.
 * @returns The button.
 */
export function ShowInFinderButton({ clip }: { clip: ClipSummary }) {
  const reveal = useRevealClip();
  return (
    <button
      type="button"
      className="mac-button clip-panel__grow"
      onClick={() => {
        reveal(clip.clip_id);
      }}
    >
      <Icon name="reveal" size="xs" />
      Show in Finder
    </button>
  );
}

/**
 * "⋯": Open and Delete….
 * @param props - The clip.
 * @returns The button, its menu and the delete sheet.
 */
export function ClipMoreButton({ clip }: { clip: ClipSummary }) {
  const navigate = useNavigate();
  const menu = useMenu();
  const [deleting, setDeleting] = useState<DeleteTarget[]>([]);
  const items: MenuEntry[] = [
    {
      kind: 'item',
      label: 'Open',
      hint: '⏎',
      onSelect: () => {
        void navigate(`/clips/${encodeURIComponent(clip.clip_id)}`);
      },
    },
    { kind: 'separator' },
    {
      kind: 'item',
      label: 'Delete…',
      hint: '⌘⌫',
      isDanger: true,
      onSelect: () => {
        setDeleting([{ clipId: clip.clip_id, title: clip.title }]);
      },
    },
  ];
  return (
    <>
      <button type="button" className="mac-button mac-button--icon" aria-label="More" aria-haspopup="menu" onClick={menu.openFromButton}>
        <Icon name="more" size="xs" />
      </button>
      <Menu anchor={menu.anchor} label={clip.title} onClose={menu.close} items={items} />
      <ClipDeleteSheet
        targets={deleting}
        onCancel={() => {
          setDeleting([]);
        }}
        onDone={() => {
          setDeleting([]);
        }}
      />
    </>
  );
}

/**
 * The Gallery's right column (Gallery V1/V2): loads the clip's detail and composes every part.
 * Key it by clip id so the tab resets when the clip changes.
 * @param props - The clip.
 * @returns The column.
 */
export function GalleryClipPanel({ clip }: { clip: ClipSummary }) {
  const { state } = useClip(clip.clip_id);
  const detail = state.status === 'ready' ? state.data : null;
  return (
    <ClipPanel>
      <ClipPanelHeader clip={clip} />
      <ClipPanelTabs clip={clip} detail={detail} />
      <ClipPanelFooter>
        <MakeShortButton clip={clip} detail={detail}>
          <Icon name="scissors" size="xs" />
          Make a short
        </MakeShortButton>
        <OfflineSwitchRow clip={clip} />
        <ClipPanelButtons>
          <AddToProjectButton clip={clip}>
            <Icon name="folder" size="xs" />
            Add to project
          </AddToProjectButton>
          <ShowInFinderButton clip={clip} />
          <ClipMoreButton clip={clip} />
        </ClipPanelButtons>
      </ClipPanelFooter>
    </ClipPanel>
  );
}
