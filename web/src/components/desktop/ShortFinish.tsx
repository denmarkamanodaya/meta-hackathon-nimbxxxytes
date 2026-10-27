// Mac Short page right column (mock M2): "Finish it on your Mac" (open the cut as an FCPXML
// timeline in Final Cut Pro, or reveal it for Resolve and Premiere, or reveal the render) and
// "In the timeline" (each shot with its start, thumb, name, the editor's reason, and whether the
// timeline links the original or the proxy).
import { useMemo } from 'react';
import type { ShotNames } from '../../core/humanize';
import { nleShots } from '../../core/nle-shots';
import { Button } from '../../design/Button';
import { Spinner } from '../../design/Spinner';
import { useNleActions, useOriginalsOnDisk } from '../../hooks/useDesktop';
import type { ShortDetail, ShortVersion } from '../../services/api/types';
import './ShortFinish.css';

/** What the FCPXML leaves out; the Open button's tooltip. */
const NOT_EXPORTED = 'Captions, punch-in and transitions are not exported.';

/** Props for `ShortFinish`. */
export interface ShortFinishProps {
  detail: ShortDetail;
  shown: ShortVersion;
  names: ShotNames;
}

function FinishCard({ shortId, hasRender }: { shortId: string; hasRender: boolean }) {
  const { openInFinalCut, revealFcpxml, revealRender, isOpening, isFinderFallback } = useNleActions(shortId);
  return (
    <section className="short-finish__card" aria-label="Finish on your Mac">
      <h2 className="short-finish__title">Finish it on your Mac</h2>
      <p className="short-finish__muted">
        Opens the AI’s cut as an editable timeline, media already linked from ~/nimbytes. Captions, punch-in and
        transitions stay in nimbytes; you finish those in your editor.
      </p>
      <div className="short-finish__buttons">
        <Button
          title={NOT_EXPORTED}
          disabled={isOpening}
          onClick={() => {
            void openInFinalCut();
          }}
        >
          {isOpening && <Spinner />}
          Open in Final Cut Pro
        </Button>
        <Button variant="secondary" onClick={revealFcpxml}>
          Reveal FCPXML (Resolve, Premiere)
        </Button>
        {hasRender && (
          <Button variant="secondary" onClick={revealRender}>
            Reveal render
          </Button>
        )}
      </div>
      {isFinderFallback && (
        <span className="short-finish__small" role="status">
          Final Cut Pro isn’t installed, so this opens the folder. In DaVinci Resolve: File › Import › Timeline.
        </span>
      )}
    </section>
  );
}

function TimelineCard({ detail, shown, names }: ShortFinishProps) {
  const shots = useMemo(() => nleShots(shown.timeline.clips, detail.segments, names), [shown, detail.segments, names]);
  const clipIds = useMemo(
    () => [...new Set(shots.map((shot) => shot.clipId).filter((id): id is string => id !== null))],
    [shots],
  );
  const originals = useOriginalsOnDisk(clipIds);
  return (
    <section className="short-finish__card short-finish__card--list" aria-label="What the timeline contains">
      <div className="short-finish__list-head">
        <h2 className="short-finish__title">In the timeline</h2>
        <span className="short-finish__small">{`${String(shots.length)} ${shots.length === 1 ? 'shot' : 'shots'} · each marker holds the AI’s reason`}</span>
      </div>
      <ol className="short-finish__shots">
        {shots.map((shot) => {
          const isOriginal = shot.clipId !== null && originals.get(shot.clipId) === true;
          return (
            <li key={shot.key} className="short-finish__shot">
              <span className="short-finish__at">{shot.at}</span>
              <span className="short-finish__thumb">
                {shot.thumbUrl !== null && <img src={shot.thumbUrl} alt="" loading="lazy" />}
              </span>
              <span className="short-finish__text">
                <span className="short-finish__name">{shot.name}</span>
                <span className="short-finish__small">{shot.reason}</span>
              </span>
              <span className={isOriginal ? 'short-finish__src short-finish__src--original' : 'short-finish__src'}>
                {isOriginal ? 'Original' : 'Proxy'}
              </span>
            </li>
          );
        })}
      </ol>
    </section>
  );
}

/**
 * The right column.
 * @param props - See `ShortFinishProps`.
 * @returns The two cards.
 */
export function ShortFinish({ detail, shown, names }: ShortFinishProps) {
  return (
    <div className="short-finish">
      <FinishCard shortId={detail.short.short_id} hasRender={detail.short.render_url !== null} />
      <TimelineCard detail={detail} shown={shown} names={names} />
    </div>
  );
}
