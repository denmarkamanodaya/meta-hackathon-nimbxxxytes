// Mac Studio › Shorts inspector (M4): the selected short's 4:5 preview (opens it), its name, "3
// drafts · from 4 moments in 2 clips", the editor score with a bar and the editor's note, and the
// hand-off: Open in Final Cut Pro, Reveal in Finder (the render, else the timeline) and ⋯.
import { Link } from 'react-router';
import { pickBestVersion, SCORE_MAX } from '../../core/agent-trail';
import { formatDuration } from '../../core/format';
import { editorNote, inspectorLine } from '../../core/studio';
import { Button } from '../../design/Button';
import { Spinner } from '../../design/Spinner';
import { useNleActions } from '../../hooks/useDesktop';
import { useShort } from '../../hooks/useEditor';
import type { ShortDetail, ShortListItem } from '../../services/api/types';
import { ScoreBar } from '../ShortBadges';
import { ShortMenu } from '../ShortMenu';
import './ShortInspector.css';

/** Props for `ShortInspector`. */
export interface ShortInspectorProps {
  item: ShortListItem;
  onDeleted: () => void;
}

function Details({ detail }: { detail: ShortDetail }) {
  const bestN = pickBestVersion(detail.versions, detail.short.best_version);
  const shown = detail.versions.find((version) => version.n === bestN);
  if (shown === undefined) return <span className="short-inspector__muted">No draft yet</span>;
  return (
    <>
      <span className="short-inspector__muted">{inspectorLine(detail, shown)}</span>
      {shown.score_total !== null && (
        <span className="short-inspector__score">
          <span className="short-inspector__score-head">
            <b>Editor score</b>
            <span className="short-inspector__mono">{`${String(shown.score_total)} / ${String(SCORE_MAX)}`}</span>
          </span>
          <ScoreBar score={shown.score_total} isWide />
          <span className="short-inspector__muted">{editorNote(shown)}</span>
        </span>
      )}
    </>
  );
}

function Handoff({ item, hasRender, onDeleted }: ShortInspectorProps & { hasRender: boolean }) {
  const { openInFinalCut, revealFcpxml, revealRender, isOpening } = useNleActions(item.short_id);
  const isReady = item.status === 'ready';
  return (
    <div className="short-inspector__actions">
      <Button
        disabled={!isReady || isOpening}
        onClick={() => {
          void openInFinalCut();
        }}
      >
        {isOpening && <Spinner />}
        Open in Final Cut Pro
      </Button>
      <div className="short-inspector__row">
        <Button variant="secondary" disabled={!isReady} onClick={hasRender ? revealRender : revealFcpxml}>
          Reveal in Finder
        </Button>
        <ShortMenu shortId={item.short_id} actions={[]} onDeleted={onDeleted} />
      </div>
    </div>
  );
}

/**
 * The inspector.
 * @param props - See `ShortInspectorProps`.
 * @returns The aside.
 */
export function ShortInspector({ item, onDeleted }: ShortInspectorProps) {
  const { state } = useShort(item.short_id);
  const detail = state.status === 'ready' ? state.data : null;
  return (
    <aside className="short-inspector" aria-label="Selected short">
      <Link className="short-inspector__preview" to={`/editor/${encodeURIComponent(item.short_id)}`} aria-label={`Open “${item.prompt}”`}>
        {item.thumb_url !== null && <img src={item.thumb_url} alt="" />}
        <span className="short-inspector__duration">{formatDuration(item.target_s)}</span>
      </Link>
      <b className="short-inspector__title">{item.prompt}</b>
      {detail === null ? (
        <span className="short-inspector__muted">{state.status === 'loading' ? 'Loading…' : ''}</span>
      ) : (
        <Details detail={detail} />
      )}
      <Handoff item={item} hasRender={detail?.short.render_url != null} onDeleted={onDeleted} />
    </aside>
  );
}
