// The Make-a-short bottom bar (Mist): "Adjust cut" (opens the timeline editor) and
// "Export 1080p" (the final render); once the final is ready, Download and Share. A story short
// shows "Adjust cut" and "Finish" instead (render and share happen on Publish).
import { PRODUCTION_COPY } from '../core/copy';
import { Button, buttonClassName } from '../design/Button';
import { Spinner } from '../design/Spinner';
import { useShareVideo, type FinalRender } from '../hooks/useEditor';
import type { Short } from '../services/api/types';
import './ShortActions.css';

/** Props for `ShortActions`. */
export interface ShortActionsProps {
  short: Short;
  /** Draft that Export renders. */
  versionN: number;
  /** Post caption, used as the share title. */
  caption: string;
  /** The agent is still drafting: both actions wait for it. */
  isWorking: boolean;
  onAdjust: () => void;
  /** The final render, shared with the page's ⋯ menu so both show the same progress. */
  final: FinalRender;
  /** A story short's Finish step (privacy, then publish); the bar then shows Adjust cut and Finish. */
  onFinish?: () => void;
}

/**
 * The bar.
 * @param props - See `ShortActionsProps`.
 * @returns The fixed bottom bar.
 */
export function ShortActions({ short, versionN, caption, isWorking, onAdjust, final, onFinish }: ShortActionsProps) {
  const share = useShareVideo();
  const isRendering = short.render_url === null && short.status !== 'failed' && final.isPending;
  const filename = `nimbytes-${short.short_id}.mp4`;

  if (onFinish !== undefined) {
    return (
      <div className="short-actions">
        <Button variant="secondary" size="lg" disabled={isWorking} onClick={onAdjust}>
          Adjust cut
        </Button>
        <Button size="lg" disabled={isWorking} onClick={onFinish}>
          {PRODUCTION_COPY.finish}
        </Button>
      </div>
    );
  }
  if (short.render_url !== null) {
    const url = short.render_url;
    return (
      <div className="short-actions">
        <a className={buttonClassName('secondary', 'lg')} href={url} download={filename}>
          Download
        </a>
        <Button
          size="lg"
          disabled={share.state === 'sharing'}
          onClick={() => {
            void share.share(url, filename, caption);
          }}
        >
          {share.state === 'sharing' ? 'Preparing…' : share.state === 'unsupported' ? 'Use Download' : 'Share'}
        </Button>
      </div>
    );
  }
  return (
    <div className="short-actions">
      <Button variant="secondary" size="lg" disabled={isWorking} onClick={onAdjust}>
        Adjust cut
      </Button>
      <Button
        size="lg"
        disabled={isWorking || isRendering}
        onClick={() => {
          void final.render(versionN);
        }}
      >
        {isRendering ? (
          <>
            <Spinner />
            Exporting…
          </>
        ) : (
          'Export 1080p'
        )}
      </Button>
    </div>
  );
}
