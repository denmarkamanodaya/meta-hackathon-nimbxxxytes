// Publish a short (`/editor/:id/publish`): one tab per platform (TikTok, Reels, Shorts, Feed),
// each with its covers to pick from (the title laid over them), the Style chips and "Make 3 more
// · <style>", the cover title's switch and text, Redraw with words on the picked cover, its
// caption with a counter against the platform's limit, removable hashtags and the render row;
// then "Copy caption" and "Share video" (the system share sheet; Download where it cannot share).
// The Mac app draws its own Publish page (MacPublishPage).
import { useId, useState } from 'react';
import { useParams } from 'react-router';
import { BackHeader } from '../components/BackHeader';
import { LoadError } from '../components/LoadError';
import { CoverPicture } from '../components/CoverPicture';
import { MoreCovers, RedrawWithWords, StyleChips, TitleSwitch, TitleText } from '../components/CoverControls';
import { DrawingVeil } from '../components/DrawingVeil';
import { shortName } from '../core/agent-trail';
import { MUSE_IMAGE_COPY, PLATFORM_COPY, PRODUCTION_COPY } from '../core/copy';
import {
  captionCount,
  cutFacts,
  postText,
  publishStepLine,
  renderLine,
  withoutHashtag,
  type CutFacts,
} from '../core/publish';
import { BottomBar } from '../design/BottomBar';
import { Button, buttonClassName } from '../design/Button';
import { Chip } from '../design/Chip';
import { EmptyState } from '../design/EmptyState';
import { Icon } from '../design/Icon';
import { Section } from '../design/Section';
import { SegmentedTabs } from '../design/SegmentedTabs';
import { Skeleton } from '../design/Skeleton';
import { Spinner } from '../design/Spinner';
import { useDesktopSlots } from '../hooks/desktop-slots';
import { useCoverControls } from '../hooks/useCoverControls';
import { useShareVideo, useShort } from '../hooks/useEditor';
import { useCopyCaption, useExports, type ExportsHandle } from '../hooks/useExports';
import { PLATFORMS, type ExportItem, type Platform } from '../services/api/types';
import './PublishPage.css';

const TABS = PLATFORMS.map((value) => ({ value, label: PLATFORM_COPY[value] }));

function Covers({ item, handle, isBusy }: { item: ExportItem; handle: ExportsHandle; isBusy: boolean }) {
  const controls = useCoverControls(item, handle, isBusy);
  const name = PLATFORM_COPY[item.platform];
  const frame = `publish__cover publish__cover--${item.aspect.replace(':', '-')}`;
  return (
    <Section title={MUSE_IMAGE_COPY.cover}>
      <StyleChips controls={controls} />
      {controls.tiles.length === 0 ? (
        <p className="publish__muted">{isBusy ? 'Drawing covers…' : 'No covers yet.'}</p>
      ) : (
        <ul className="publish__covers">
          {controls.tiles.map((tile) => (
            <li key={tile.url}>
              <button
                type="button"
                className={`${frame}${tile.isPicked ? ' publish__cover--on' : ''}`}
                aria-pressed={tile.isPicked}
                aria-label={`${tile.label} for ${name}`}
                onClick={() => {
                  controls.use(tile.index);
                }}
              >
                <CoverPicture url={tile.url} alt="" overlay={controls.overlay} size="strip">
                  {tile.isPicked && (
                    <span className="publish__tick" aria-hidden="true">
                      <Icon name="check" size="sm" />
                    </span>
                  )}
                </CoverPicture>
              </button>
            </li>
          ))}
          {controls.isRedrawing && (
            <li>
              <span className={frame}>
                <DrawingVeil label={MUSE_IMAGE_COPY.redrawing} />
              </span>
            </li>
          )}
        </ul>
      )}
      <MoreCovers controls={controls} buttonClass={buttonClassName('secondary')} />
      <div className="publish__cover-title">
        <TitleSwitch controls={controls} isShown={item.cover_title.show} />
        <TitleText controls={controls} />
      </div>
      <RedrawWithWords controls={controls} buttonClass={buttonClassName('secondary')} />
    </Section>
  );
}

interface CaptionProps {
  item: ExportItem;
  handle: ExportsHandle;
  /** The caption as typed and not saved yet; null when it matches the saved one. */
  draft: string | null;
  setDraft: (text: string | null) => void;
}

function Caption({ item, handle, draft, setDraft }: CaptionProps) {
  const id = useId();
  const text = draft ?? item.caption;
  const count = captionCount(text, item.caption_limit);
  const label = item.platform === 'shorts' ? 'Title' : 'Caption';
  return (
    <Section title={label}>
      <textarea
        id={id}
        aria-label={`${label} for ${PLATFORM_COPY[item.platform]}`}
        aria-describedby={`${id}-count`}
        className="publish__caption"
        rows={item.platform === 'shorts' ? 2 : 4}
        value={text}
        onChange={(event) => {
          setDraft(event.target.value);
        }}
        onBlur={() => {
          if (draft === null || draft.trim() === item.caption || count.isOver) return;
          void handle.edit(item.platform, { caption: draft }).then((ok) => {
            if (ok) setDraft(null);
          });
        }}
      />
      <p id={`${id}-count`} className={`publish__count${count.isOver ? ' publish__count--over' : ''}`} aria-live="polite">
        {count.isOver ? `${count.label} · ${String(-count.left)} over` : count.label}
      </p>
      {item.hashtags.length > 0 && (
        <ul className="publish__tags" aria-label="Hashtags">
          {item.hashtags.map((tag) => (
            <li key={tag}>
              <Chip
                actionLabel={`Remove ${tag}`}
                onClick={() => {
                  void handle.edit(item.platform, { hashtags: withoutHashtag(item.hashtags, tag) });
                }}
              >
                {tag}
                <Icon name="close" size="xs" />
              </Chip>
            </li>
          ))}
        </ul>
      )}
    </Section>
  );
}

interface RenderRowProps {
  item: ExportItem;
  cut: CutFacts | null;
  /** Starts this platform again; shown once its render failed. */
  onRetry: () => void;
  isBusy: boolean;
}

function RenderRow({ item, cut, onRetry, isBusy }: RenderRowProps) {
  const isRendering = item.status === 'queued' || item.status === 'rendering';
  const isFailed = item.status === 'failed';
  return (
    <div className={`publish__render${isFailed ? ' publish__render--failed' : ''}`}>
      <p className="publish__render-status" role="status">
        {isRendering ? <Spinner /> : <Icon name={item.status === 'ready' ? 'check' : 'info'} size="sm" />}
        <span className="publish__render-line">{renderLine(item, cut)}</span>
      </p>
      {isFailed && (
        <Button variant="secondary" disabled={isBusy} onClick={onRetry}>
          {PRODUCTION_COPY.renderAgain}
        </Button>
      )}
    </div>
  );
}

function Actions({ item, title, onCopy }: { item: ExportItem | null; title: string; onCopy: () => void }) {
  const isMac = useDesktopSlots() !== null;
  const share = useShareVideo();
  const url = item?.render_url ?? null;
  const filename = item === null ? 'nimbytes.mp4' : `nimbytes-${item.platform}.mp4`;
  const canDownloadOnly = isMac || share.state === 'unsupported';
  return (
    <BottomBar>
      <Button variant="secondary" size="lg" disabled={item === null} onClick={onCopy}>
        {PRODUCTION_COPY.copyCaption}
      </Button>
      {url === null ? (
        <Button size="lg" disabled>
          {canDownloadOnly ? PRODUCTION_COPY.download : PRODUCTION_COPY.shareVideo}
        </Button>
      ) : canDownloadOnly ? (
        <a className={buttonClassName('primary', 'lg')} href={url} download={filename}>
          {PRODUCTION_COPY.download}
        </a>
      ) : (
        <Button
          size="lg"
          disabled={share.state === 'sharing'}
          onClick={() => {
            void share.share(url, filename, title);
          }}
        >
          {share.state === 'sharing' ? 'Preparing…' : PRODUCTION_COPY.shareVideo}
        </Button>
      )}
    </BottomBar>
  );
}

/**
 * The page.
 * @returns The Publish screen.
 */
export function PublishPage() {
  const { id = '' } = useParams();
  const back = `/editor/${encodeURIComponent(id)}`;
  const panelId = useId();
  const short = useShort(id);
  const handle = useExports(id);
  const copy = useCopyCaption();
  const [platform, setPlatform] = useState<Platform>('tiktok');
  const [drafts, setDrafts] = useState<Partial<Record<Platform, string | undefined>>>({});
  const detail = short.state.status === 'ready' ? short.state.data : null;
  const title = detail === null ? '' : shortName(detail.versions.find((v) => v.n === detail.short.best_version));
  const { state } = handle;

  if (state.status === 'loading') {
    return (
      <div className="publish" aria-busy="true">
        <BackHeader title={PRODUCTION_COPY.publish} subtitle={title} fallback={back} />
        <Skeleton kind="video" />
      </div>
    );
  }
  if (state.status === 'error') {
    return (
      <div className="publish">
        <BackHeader title={PRODUCTION_COPY.publish} subtitle={title} fallback={back} />
        <LoadError error={state.error} thing="publish pack" onRetry={handle.refresh} />
      </div>
    );
  }
  const { exports, busy } = state.data;
  const item = exports.find((e) => e.platform === platform) ?? null;
  return (
    <div className="publish">
      <BackHeader title={PRODUCTION_COPY.publish} subtitle={title} fallback={back} />
      {busy && (
        <p className="publish__progress" role="status">
          <Spinner />
          {publishStepLine(handle.progress?.step ?? null, handle.progress?.status ?? null)}
        </p>
      )}
      {exports.length === 0 && !busy ? (
        <EmptyState
          icon="share"
          title="No publish pack yet"
          body="Make captions, hashtags, covers and a 9:16 render for each platform."
          action={
            <Button
              size="lg"
              onClick={() => {
                void handle.start([...PLATFORMS]);
              }}
            >
              {PRODUCTION_COPY.renderAndPublish}
            </Button>
          }
        />
      ) : (
        <>
          <div className="publish__tabs">
            <SegmentedTabs label="Platform" options={TABS} value={platform} onChange={setPlatform} panelId={panelId} />
          </div>
          <div id={panelId} role="tabpanel" aria-label={PLATFORM_COPY[platform]} className="publish__panel">
            {item === null ? (
              <p className="publish__muted">Not made for this platform yet.</p>
            ) : (
              <>
                <RenderRow
                  item={item}
                  cut={cutFacts(detail)}
                  isBusy={busy}
                  onRetry={() => {
                    void handle.start([item.platform]);
                  }}
                />
                <Covers key={`covers-${item.platform}`} item={item} handle={handle} isBusy={busy} />
                <Caption
                  key={`caption-${item.platform}`}
                  item={item}
                  handle={handle}
                  draft={drafts[item.platform] ?? null}
                  setDraft={(text) => {
                    setDrafts((all) => ({ ...all, [item.platform]: text ?? undefined }));
                  }}
                />
              </>
            )}
          </div>
        </>
      )}
      <Actions
        item={item}
        title={title}
        onCopy={() => {
          if (item !== null) void copy(postText(drafts[item.platform] ?? item.caption, item.hashtags));
        }}
      />
    </div>
  );
}
