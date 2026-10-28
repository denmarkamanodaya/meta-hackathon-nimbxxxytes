// Publish on the Mac (redesign v2, board V14): "‹ Short / Publish <short>" with the platform tabs;
// the render row ("9:16 render · 0:10", who shares it, its status); the Cover section (how many of
// 9, the Style chips, the strip of covers with the title laid over them in CSS, "Make 3 more ·
// <style>" and its cost); the caption with its counter; and on the right the selected cover large,
// the Title switch, its text and position, Redraw with words, Use this cover and Download cover.
// A tile click previews that cover; Use this cover saves it as the platform's pick.
import { useId, useState } from 'react';
import { useParams } from 'react-router';
import { ClipPanel, ClipPanelFooter } from '../../components/desktop/ClipPanel';
import { MacColumns, MacCrumb, MacPill, type MacPillTone } from '../../components/desktop/MacColumns';
import { CoverPicture } from '../../components/CoverPicture';
import {
  CutoutBackgroundSwitch,
  HowCutoutIsMade,
  MoreCovers,
  RedrawWithWords,
  StyleChips,
  TitlePosition,
  TitleSwitch,
  TitleText,
} from '../../components/CoverControls';
import { DrawingVeil } from '../../components/DrawingVeil';
import { LoadError } from '../../components/LoadError';
import { shortName } from '../../core/agent-trail';
import { MUSE_IMAGE_COPY, PLATFORM_COPY, PRODUCTION_COPY } from '../../core/copy';
import {
  captionCount,
  coverCountLine,
  cutFacts,
  macRenderLine,
  postText,
  publishStepLine,
  renderSharedLine,
  renderStatusWord,
  type CutFacts,
} from '../../core/publish';
import { EmptyState } from '../../design/EmptyState';
import { Icon } from '../../design/Icon';
import { SegmentedTabs } from '../../design/SegmentedTabs';
import { Skeleton } from '../../design/Skeleton';
import { Spinner } from '../../design/Spinner';
import { useCoverControls, type CoverControls } from '../../hooks/useCoverControls';
import { useShort } from '../../hooks/useEditor';
import { useCopyCaption, useExports, type ExportsHandle } from '../../hooks/useExports';
import { PLATFORMS, type ExportItem, type ExportStatus, type Platform } from '../../services/api/types';
import './MacPublishPage.css';

const TABS = PLATFORMS.map((value) => ({ value, label: PLATFORM_COPY[value] }));

const STATUS_TONE: Record<ExportStatus, MacPillTone> = {
  queued: 'neutral',
  rendering: 'accent',
  ready: 'success',
  failed: 'danger',
};

const frameClass = (item: ExportItem) => `mac-publish__frame mac-publish__frame--${item.aspect.replace(':', '-')}`;

function RenderRow({ item, cut, handle, isBusy }: { item: ExportItem; cut: CutFacts | null; handle: ExportsHandle; isBusy: boolean }) {
  const picked = item.covers[item.cover_pick] ?? item.covers[0];
  return (
    <div className="mac-publish__render">
      <span className="mac-publish__render-thumb">{picked !== undefined && <img src={picked.url} alt="" />}</span>
      <span className="mac-publish__render-text">
        <span className="mac-publish__render-line">{macRenderLine(item.aspect, cut)}</span>
        <span className="mac-columns__sub">{renderSharedLine(item.aspect)}</span>
      </span>
      {item.render_url !== null && (
        <a className="mac-button mac-button--head" href={item.render_url} download={`nimbytes-${item.platform}.mp4`}>
          {PRODUCTION_COPY.download}
        </a>
      )}
      {item.status === 'failed' && (
        <button
          type="button"
          className="mac-button mac-button--head"
          disabled={isBusy}
          onClick={() => {
            void handle.start([item.platform]);
          }}
        >
          {PRODUCTION_COPY.renderAgain}
        </button>
      )}
      <MacPill tone={STATUS_TONE[item.status]}>{renderStatusWord(item.status)}</MacPill>
    </div>
  );
}

function CoverStrip({ item, controls, isBusy }: { item: ExportItem; controls: CoverControls; isBusy: boolean }) {
  const frame = frameClass(item);
  return (
    <section className="mac-publish__section" aria-label={MUSE_IMAGE_COPY.cover}>
      <div className="mac-publish__section-head">
        <h2 className="mac-publish__h2">{MUSE_IMAGE_COPY.cover}</h2>
        <span className="mac-publish__note">{coverCountLine(item.covers.length)}</span>
      </div>
      <StyleChips controls={controls} />
      {controls.tiles.length === 0 && !controls.isRedrawing ? (
        <p className="mac-columns__sub">{isBusy ? 'Drawing covers…' : 'No covers yet.'}</p>
      ) : (
        <ul className="mac-publish__strip">
          {controls.tiles.map((tile) => {
            const isSelected = tile.index === controls.selected?.index;
            return (
              <li key={tile.url} className="mac-publish__tile">
                <button
                  type="button"
                  className={isSelected ? `${frame} mac-publish__frame--on` : frame}
                  aria-label={tile.label}
                  aria-pressed={isSelected}
                  onClick={() => {
                    controls.select(tile.index);
                  }}
                >
                  <CoverPicture url={tile.url} alt="" overlay={controls.overlayFor(tile)} size="strip">
                    {tile.isPicked && (
                      <span className="mac-publish__tick" aria-label="In use">
                        <Icon name="check" size="xs" />
                      </span>
                    )}
                  </CoverPicture>
                </button>
                <span className="mac-publish__tile-label">{tile.label}</span>
              </li>
            );
          })}
          {controls.isRedrawing && (
            <li className="mac-publish__tile">
              <span className={frame}>
                <DrawingVeil label={MUSE_IMAGE_COPY.redrawing} />
              </span>
            </li>
          )}
        </ul>
      )}
      <MoreCovers controls={controls} buttonClass="mac-button" />
    </section>
  );
}

function Caption({ item, handle }: { item: ExportItem; handle: ExportsHandle }) {
  const id = useId();
  const copy = useCopyCaption();
  const [draft, setDraft] = useState<string | null>(null);
  const text = draft ?? item.caption;
  const count = captionCount(text, item.caption_limit);
  const label = item.platform === 'shorts' ? 'Title' : 'Caption';
  return (
    <section className="mac-publish__section mac-publish__section--rule" aria-label={label}>
      <div className="mac-publish__section-head">
        <h2 className="mac-publish__h2">{label}</h2>
        <span className="mac-publish__count-row">
          <button
            type="button"
            className="mac-button mac-button--head"
            onClick={() => {
              void copy(postText(text, item.hashtags));
            }}
          >
            {PRODUCTION_COPY.copyCaption}
          </button>
          <span id={`${id}-count`} className={count.isOver ? 'mac-publish__count mac-publish__count--over' : 'mac-publish__count'}>
            {count.label}
          </span>
        </span>
      </div>
      <div className="mac-publish__caption">
        <textarea
          aria-label={`${label} for ${PLATFORM_COPY[item.platform]}`}
          aria-describedby={`${id}-count`}
          className="mac-publish__caption-text"
          rows={2}
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
        {item.hashtags.length > 0 && <span className="mac-publish__tags">{item.hashtags.join(' ')}</span>}
      </div>
    </section>
  );
}

function SelectedCover({ item, controls }: { item: ExportItem; controls: CoverControls }) {
  const selected = controls.selected;
  const download = item.download_cover_url;
  return (
    <ClipPanel>
      <div className="mac-publish__aside">
        <div className="mac-publish__preview">
          <span className={`${frameClass(item)} mac-publish__frame--large`}>
            {selected !== undefined && <CoverPicture url={selected.url} alt={selected.label} overlay={controls.overlayFor(selected)} size="large" />}
          </span>
        </div>
        {controls.isCutout ? (
          <>
            <div className="mac-publish__group">
              <CutoutBackgroundSwitch controls={controls} />
            </div>
            <div className="mac-publish__group">
              <HowCutoutIsMade />
            </div>
          </>
        ) : (
          <>
            <div className="mac-publish__group">
              <TitleSwitch controls={controls} isShown={item.cover_title.show} />
              <TitleText controls={controls} />
              <TitlePosition controls={controls} position={item.cover_title.position} />
            </div>
            <div className="mac-publish__group">
              <RedrawWithWords controls={controls} buttonClass="mac-button mac-publish__redraw" />
            </div>
          </>
        )}
      </div>
      <ClipPanelFooter>
        <button
          type="button"
          className="mac-button mac-button--primary"
          disabled={selected === undefined || selected.isPicked}
          onClick={() => {
            if (selected !== undefined) controls.use(selected.index);
          }}
        >
          {MUSE_IMAGE_COPY.useThisCover}
        </button>
        {download === null ? (
          <button type="button" className="mac-button" disabled>
            {MUSE_IMAGE_COPY.downloadCover}
          </button>
        ) : (
          <a className="mac-button" href={download} download={`nimbytes-${item.platform}-cover.jpg`}>
            {MUSE_IMAGE_COPY.downloadCover}
          </a>
        )}
      </ClipPanelFooter>
    </ClipPanel>
  );
}

interface HeaderProps {
  shortId: string;
  title: string;
  platform: Platform;
  onPlatform: (platform: Platform) => void;
  panelId: string;
  hasTabs: boolean;
}

function Header({ shortId, title, platform, onPlatform, panelId, hasTabs }: HeaderProps) {
  return (
    <header className="mac-columns__head mac-columns__head--crumb">
      <MacCrumb to={`/editor/${encodeURIComponent(shortId)}`} label="Short" />
      <h1 className="mac-columns__crumb-title">{PRODUCTION_COPY.publish}</h1>
      <span className="mac-columns__sub">{title}</span>
      <span className="mac-columns__grow" />
      {hasTabs && (
        <span className="mac-publish__tabs">
          <SegmentedTabs label="Platform" options={TABS} value={platform} onChange={onPlatform} panelId={panelId} />
        </span>
      )}
    </header>
  );
}

function Progress({ handle }: { handle: ExportsHandle }) {
  return (
    <p className="mac-publish__progress" role="status">
      <Spinner />
      {publishStepLine(handle.progress?.step ?? null, handle.progress?.status ?? null)}
    </p>
  );
}

interface PlatformPageProps {
  item: ExportItem;
  cut: CutFacts | null;
  handle: ExportsHandle;
  isBusy: boolean;
  header: HeaderProps;
}

/** One platform's page; keyed by platform so its drafts start fresh on each tab. */
function PlatformPage({ item, cut, handle, isBusy, header }: PlatformPageProps) {
  const controls = useCoverControls(item, handle, isBusy);
  return (
    <MacColumns asideLabel="Selected cover" aside={<SelectedCover item={item} controls={controls} />}>
      <Header {...header} />
      <div id={header.panelId} role="tabpanel" aria-label={PLATFORM_COPY[item.platform]} className="mac-publish__body">
        {isBusy && <Progress handle={handle} />}
        <RenderRow item={item} cut={cut} handle={handle} isBusy={isBusy} />
        <CoverStrip item={item} controls={controls} isBusy={isBusy} />
        <Caption item={item} handle={handle} />
      </div>
    </MacColumns>
  );
}

/**
 * The page (`/editor/:id/publish` in the Mac app).
 * @returns The page.
 */
export function MacPublishPage() {
  const { id = '' } = useParams();
  const panelId = useId();
  const short = useShort(id);
  const handle = useExports(id);
  const [platform, setPlatform] = useState<Platform>('tiktok');
  const detail = short.state.status === 'ready' ? short.state.data : null;
  const title = detail === null ? '' : shortName(detail.versions.find((v) => v.n === detail.short.best_version));
  const { state } = handle;
  const header: HeaderProps = { shortId: id, title, platform, onPlatform: setPlatform, panelId, hasTabs: false };

  if (state.status !== 'ready') {
    return (
      <MacColumns>
        <Header {...header} />
        <div className="mac-publish__body">
          {state.status === 'loading' ? (
            <div aria-busy="true">
              <p className="visually-hidden" role="status">
                Loading the publish pack…
              </p>
              <Skeleton kind="line" />
              <Skeleton kind="line" />
            </div>
          ) : (
            <LoadError error={state.error} thing="publish pack" onRetry={handle.refresh} />
          )}
        </div>
      </MacColumns>
    );
  }
  const { exports, busy } = state.data;
  const item = exports.find((e) => e.platform === platform) ?? null;
  if (item !== null) {
    return (
      <PlatformPage key={platform} item={item} cut={cutFacts(detail)} handle={handle} isBusy={busy} header={{ ...header, hasTabs: true }} />
    );
  }
  return (
    <MacColumns>
      <Header {...header} hasTabs={exports.length > 0} />
      <div className="mac-publish__body">
        {busy && <Progress handle={handle} />}
        {exports.length === 0 && !busy ? (
          <EmptyState
            icon="share"
            title="No publish pack yet"
            body="Make captions, hashtags, covers and a 9:16 render for each platform."
            action={
              <button
                type="button"
                className="mac-button mac-button--primary"
                onClick={() => {
                  void handle.start([...PLATFORMS]);
                }}
              >
                {PRODUCTION_COPY.renderAndPublish}
              </button>
            }
          />
        ) : (
          <p className="mac-columns__sub">Not made for this platform yet.</p>
        )}
      </div>
    </MacColumns>
  );
}
