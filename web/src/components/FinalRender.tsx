// Final render of the chosen version: render → progress → download and share.
import { Button, buttonClassName } from '../design/Button';
import { Card } from '../design/Card';
import { Icon } from '../design/Icon';
import { Spinner } from '../design/Spinner';
import { useFinalRender, useShareVideo } from '../hooks/useEditor';
import type { Short } from '../services/api/types';
import './FinalRender.css';

/** Props for `FinalRender`. */
export interface FinalRenderProps {
  short: Short;
  /** Version the user chose (shown in the stepper). */
  versionN: number;
  /** Post caption, used as the share title. */
  caption: string;
  refresh: () => void;
}

/**
 * Card with the render button, its progress, and the finished file's actions.
 * @param props - See `FinalRenderProps`.
 * @returns The card.
 */
export function FinalRender({ short, versionN, caption, refresh }: FinalRenderProps) {
  const { state, render } = useFinalRender(short.short_id, refresh);
  const share = useShareVideo();
  const isRendering =
    short.render_url === null &&
    short.status !== 'failed' &&
    (state.status === 'requesting' || state.status === 'requested');
  const filename = `nimbytes-${short.short_id}.mp4`;

  return (
    <Card>
      <div className="final-render">
        <div>
          <h2 className="final-render__title">Final cut</h2>
          <p className="final-render__sub">{`${short.aspect} · 1080 wide · captions burned in`}</p>
        </div>
        {short.render_url !== null ? (
          <div className="final-render__actions">
            <Button
              disabled={share.state === 'sharing'}
              onClick={() => {
                if (short.render_url !== null) void share.share(short.render_url, filename, caption);
              }}
            >
              <Icon name="upload" />
              {share.state === 'sharing' ? 'Preparing…' : 'Share'}
            </Button>
            <a className={buttonClassName('secondary')} href={short.render_url} download={filename}>
              Download
            </a>
            {share.state === 'unsupported' && (
              <p className="final-render__note">This browser cannot share files. Use Download.</p>
            )}
          </div>
        ) : isRendering ? (
          <p className="final-render__progress" role="status">
            <Spinner /> {`Rendering v${String(versionN)} in full quality…`}
          </p>
        ) : (
          <Button
            onClick={() => {
              void render(versionN);
            }}
          >
            {`Render final (v${String(versionN)})`}
          </Button>
        )}
      </div>
    </Card>
  );
}
