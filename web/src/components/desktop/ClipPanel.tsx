// The right column for one clip (redesign v2, Gallery V1/V2; reused by the clip player page): a
// preview that opens the clip, the title and meta line, where the clip is on this Mac, the
// Moments / Speech / Faces tabs, then Make a short, the Make available offline switch, Add to
// project, Show in Finder and More. Loads the clip's detail itself unless the caller passes it.
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

/** Props for `ClipPanel`. */
export interface ClipPanelProps {
  clip: ClipSummary;
  /** The clip's detail when the caller has it (the player page); absent, the panel loads it. */
  detail?: ClipDetail | null;
  /** Draw the preview at the top (the Gallery); the player page shows the video itself. */
  hasPreview?: boolean;
  /** The tab it opens on. */
  defaultTab?: ClipPanelTab;
  /** A moment or speech line was picked; absent, the clip opens at that second. */
  onSeek?: (seconds: number) => void;
  /** Replaces the Speech tab's list (the player page's list that follows playback). */
  speech?: ReactNode;
}

/** How many faces the Faces tab shows before "+N". */
const FACE_CARDS = 7;

/** How often the release countdown redraws. */
const TICK_MS = 1000;

function Preview({ clip }: { clip: ClipSummary }) {
  return (
    <Link className="clip-panel__preview" to={`/clips/${encodeURIComponent(clip.clip_id)}`} aria-label={`Play ${clip.title}`}>
      {clip.thumb_url !== null && <img className="clip-panel__img" src={clip.thumb_url} alt="" />}
      <span className="clip-panel__play" aria-hidden="true">
        <Icon name="play" size="sm" />
      </span>
      {clip.duration_s !== null && <span className="clip-panel__duration">{formatDuration(clip.duration_s)}</span>}
    </Link>
  );
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

function Faces({ tracks, total }: { tracks: readonly Track[]; total: number }) {
  const shown = tracks.slice(0, tracks.length > FACE_CARDS + 1 ? FACE_CARDS : FACE_CARDS + 1);
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
        {`All ${String(total)} faces in ${NAV_COPY.faces}`}
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
  return tracks.length === 0 ? <p className="clip-panel__empty">No faces in this clip.</p> : <Faces tracks={tracks} total={tracks.length} />;
}

/** Make a short, the offline switch, and Add to project, Show in Finder and More. */
function Actions({ clip, detail }: { clip: ClipSummary; detail: ClipDetail | null }) {
  const navigate = useNavigate();
  const makeShortById = useMakeShortFromClip();
  const offline = useClipOffline(clip.clip_id);
  const reveal = useRevealClip();
  const { state } = useProjects();
  const projectActions = useProjectActions();
  const projectMenu = useMenu();
  const moreMenu = useMenu();
  const [isNewOpen, setNewOpen] = useState(false);
  const [deleting, setDeleting] = useState<DeleteTarget[]>([]);
  const isReady = clip.status === 'ready';
  const canShort = isReady && clip.segment_count > 0;
  const makeShort = () => {
    if (detail === null) makeShortById(clip.clip_id);
    else void navigate('/editor', { state: handoffFromClip(detail) });
  };
  const more: MenuEntry[] = [
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
    <div className="clip-panel__actions">
      <button type="button" className="mac-button mac-button--primary" disabled={!canShort} onClick={makeShort}>
        <Icon name="scissors" size="xs" />
        Make a short
      </button>
      <div className="clip-panel__offline">
        <span className="clip-panel__offline-text">
          <span className="clip-panel__offline-title">Make available offline</span>
          <span className="clip-panel__offline-line">{`Keeps all ${formatBytes(clip.size_bytes)} on this Mac`}</span>
        </span>
        <Toggle
          label="Make available offline"
          checked={offline.isPinned === true}
          disabled={!isReady || offline.isPinned === null || offline.isSaving}
          onChange={(next) => {
            void offline.setPinned(next);
          }}
        />
      </div>
      <div className="clip-panel__buttons">
        <button type="button" className="mac-button clip-panel__grow" aria-haspopup="menu" onClick={projectMenu.openFromButton}>
          <Icon name="folder" size="xs" />
          Add to project
        </button>
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
        <button type="button" className="mac-button mac-button--icon" aria-label="More" aria-haspopup="menu" onClick={moreMenu.openFromButton}>
          <Icon name="more" size="xs" />
        </button>
      </div>
      <Menu
        anchor={projectMenu.anchor}
        label="Add to project"
        onClose={projectMenu.close}
        items={addToProjectItems(state.status === 'ready' ? state.data : [], [clip], projectActions.toggle, () => {
          setNewOpen(true);
        })}
      />
      <Menu anchor={moreMenu.anchor} label={clip.title} onClose={moreMenu.close} items={more} />
      <NewProjectSheet
        open={isNewOpen}
        clipIds={[clip.clip_id]}
        onClose={() => {
          setNewOpen(false);
        }}
      />
      <ClipDeleteSheet
        targets={deleting}
        onCancel={() => {
          setDeleting([]);
        }}
        onDone={() => {
          setDeleting([]);
        }}
      />
    </div>
  );
}

function Panel({ clip, detail, hasPreview = true, defaultTab = 'moments', onSeek, speech }: ClipPanelProps & { detail: ClipDetail | null }) {
  const navigate = useNavigate();
  const { state } = useProjects();
  const [tab, setTab] = useState<ClipPanelTab>(defaultTab);
  const seek =
    onSeek ??
    ((seconds: number) => {
      void navigate(`/clips/${encodeURIComponent(clip.clip_id)}?t=${String(Math.floor(seconds))}`);
    });
  const panelId = `clip-panel-${clip.clip_id}`;
  return (
    <div className="clip-panel">
      <div className="clip-panel__head">
        {hasPreview && <Preview clip={clip} />}
        <div>
          <h2 className="clip-panel__title">{clip.title}</h2>
          <p className="clip-panel__meta">{panelMetaLine(clip, state.status === 'ready' ? state.data : [])}</p>
        </div>
        <Where clipId={clip.clip_id} />
      </div>
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
      <Actions clip={clip} detail={detail} />
    </div>
  );
}

function LoadingPanel(props: ClipPanelProps) {
  const { state } = useClip(props.clip.clip_id);
  return <Panel {...props} detail={state.status === 'ready' ? state.data : null} />;
}

/**
 * The panel. Key it by clip id so the tab and menus reset when the clip changes.
 * @param props - See `ClipPanelProps`.
 * @returns The panel.
 */
export function ClipPanel(props: ClipPanelProps) {
  return props.detail === undefined ? <LoadingPanel {...props} /> : <Panel {...props} detail={props.detail} />;
}
