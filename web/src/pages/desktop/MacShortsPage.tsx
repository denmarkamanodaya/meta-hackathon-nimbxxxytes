// Shorts on the Mac (redesign v2, V11a/b): "Shorts" with "2 shorts · newest first", then the All /
// Ready filters in a toolbar row like the Gallery's; one compact row per short (48 px thumb with its length, the
// post caption with its frame, the prompt or "From production “…”" with the date, the draft, the
// editor score, the status and ⋯). A click selects a row and a double-click or ⏎ opens it; ⋯ or a
// right-click offers Open, Publish… and Delete short… (⌘⌫), which asks first. The right column
// shows the selected short: its preview, title, line and hashtags, then Open, Publish… and
// Download (once a render exists). With no shorts, a compact empty state sends the owner to the
// search bar ("Find moments").
import { useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { ClipPanel, ClipPanelButtons, ClipPanelFooter } from '../../components/desktop/ClipPanel';
import { MacChip } from '../../components/desktop/MacChip';
import { MacColumns, MacPill } from '../../components/desktop/MacColumns';
import { MacConfirmDialog } from '../../components/desktop/MacConfirmDialog';
import { LoadError } from '../../components/LoadError';
import { isShortWorking, pickBestVersion } from '../../core/agent-trail';
import { MAC_STUDIO_COPY, STUDIO_COPY } from '../../core/copy';
import { SHORT_DELETE_COPY } from '../../core/delete-copy';
import { formatDuration } from '../../core/format';
import {
  draftLabel,
  filterShorts,
  scoreLabel,
  selectedShortLine,
  shortChip,
  shortsCountLine,
  shortSubLine,
  shortTitle,
  SHORTS_FILTER_LABEL,
  SHORTS_FILTERS,
  type ShortsFilter,
} from '../../core/shorts-list';
import { Icon } from '../../design/Icon';
import { Menu, type MenuEntry } from '../../design/Menu';
import { Skeleton } from '../../design/Skeleton';
import { Spinner } from '../../design/Spinner';
import { useDeleteShort } from '../../hooks/useDelete';
import { useShort } from '../../hooks/useEditor';
import { useMenu } from '../../hooks/useMenu';
import { useShortsList } from '../../hooks/useOverview';
import { useFocusSearch } from '../../hooks/useSearchBar';
import type { ShortListItem } from '../../services/api/types';
import './MacShortsPage.css';

const ASIDE_LABEL = 'Selected short';

const shortPath = (id: string) => `/editor/${encodeURIComponent(id)}`;
const publishPath = (id: string) => `${shortPath(id)}/publish`;

interface RowProps {
  item: ShortListItem;
  isSelected: boolean;
  onSelect: (id: string) => void;
  onDelete: (item: ShortListItem) => void;
}

function Row({ item, isSelected, onSelect, onDelete }: RowProps) {
  const menu = useMenu();
  const navigate = useNavigate();
  const chip = shortChip(item.status);
  const title = shortTitle(item);
  const open = () => {
    void navigate(shortPath(item.short_id));
  };
  const items: MenuEntry[] = [
    { kind: 'item', label: MAC_STUDIO_COPY.open, hint: '⏎', onSelect: open },
    {
      kind: 'item',
      label: MAC_STUDIO_COPY.publish,
      isDisabled: isShortWorking(item.status),
      onSelect: () => {
        void navigate(publishPath(item.short_id));
      },
    },
    { kind: 'separator' },
    {
      kind: 'item',
      label: MAC_STUDIO_COPY.deleteShort,
      hint: '⌘⌫',
      isDanger: true,
      onSelect: () => {
        onDelete(item);
      },
    },
  ];
  const isOpen = menu.anchor !== null;
  const rowClass = `mac-shorts__row${isSelected ? ' mac-shorts__row--on' : ''}${isOpen ? ' mac-shorts__row--menu' : ''}`;
  return (
    <li className={rowClass} onContextMenu={menu.openAtPointer}>
      <button
        type="button"
        className="mac-shorts__pick"
        aria-current={isSelected ? 'true' : undefined}
        onClick={() => {
          onSelect(item.short_id);
        }}
        onDoubleClick={open}
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            event.preventDefault();
            open();
          } else if (event.metaKey && event.key === 'Backspace') {
            event.preventDefault();
            onDelete(item);
          }
        }}
      >
        <span className="mac-shorts__thumb">
          {item.thumb_url !== null && <img src={item.thumb_url} alt="" loading="lazy" />}
          <span className="mac-shorts__len">{formatDuration(item.target_s)}</span>
        </span>
        <span className="mac-shorts__text">
          <span className="mac-shorts__title-line">
            <span className="mac-shorts__title">{title}</span>
            <MacPill isSmall>{item.aspect}</MacPill>
          </span>
          <span className="mac-shorts__sub">{shortSubLine(item)}</span>
        </span>
        <span className="mac-shorts__draft">{draftLabel(item.version_count)}</span>
        <span className="mac-shorts__score">{scoreLabel(item.best_score)}</span>
        <span className="mac-shorts__status">
          <MacPill tone={chip.tone}>
            {chip.isBusy && <Spinner />}
            {chip.label}
          </MacPill>
        </span>
      </button>
      <button
        type="button"
        className="mac-button mac-button--icon mac-button--quiet"
        aria-label={MAC_STUDIO_COPY.shortOptions}
        aria-haspopup="menu"
        aria-expanded={isOpen}
        onClick={menu.openFromButton}
      >
        <Icon name="more" size="xs" />
      </button>
      <Menu anchor={menu.anchor} label={title} items={items} onClose={menu.close} className="mac-menu--narrow" />
    </li>
  );
}

/** The right column: preview, title, line, hashtags, then Open, Publish… and Download. */
function Aside({ item }: { item: ShortListItem }) {
  const navigate = useNavigate();
  const { state } = useShort(item.short_id);
  const detail = state.status === 'ready' ? state.data : null;
  const best = detail === null ? null : pickBestVersion(detail.versions, detail.short.best_version);
  const hashtags = detail?.versions.find((version) => version.n === best)?.timeline.post.hashtags ?? [];
  const renderUrl = detail?.short.render_url ?? null;
  const title = shortTitle(item);
  return (
    <ClipPanel>
      <div className="mac-shorts__aside">
        <Link
          className={`mac-shorts__preview mac-shorts__preview--${item.aspect === '1:1' ? 'square' : 'portrait'}`}
          to={shortPath(item.short_id)}
          aria-label={`Play ${title}`}
        >
          {item.thumb_url !== null && <img src={item.thumb_url} alt="" />}
          <span className="mac-shorts__play" aria-hidden="true">
            <Icon name="play" size="sm" />
          </span>
        </Link>
        <h2 className="mac-shorts__aside-title">{title}</h2>
        <p className="mac-shorts__aside-line">{selectedShortLine(item)}</p>
        {hashtags.length > 0 && <p className="mac-shorts__tags">{hashtags.join(' ')}</p>}
      </div>
      <ClipPanelFooter>
        <Link className="mac-button mac-button--primary" to={shortPath(item.short_id)}>
          {MAC_STUDIO_COPY.open}
        </Link>
        <ClipPanelButtons>
          <button
            type="button"
            className="mac-button clip-panel__grow"
            disabled={isShortWorking(item.status)}
            onClick={() => {
              void navigate(publishPath(item.short_id));
            }}
          >
            {MAC_STUDIO_COPY.publish}
          </button>
          {renderUrl !== null ? (
            <a className="mac-button clip-panel__grow" href={renderUrl} download={`nimbytes-${item.short_id}.mp4`}>
              Download
            </a>
          ) : (
            <button type="button" className="mac-button clip-panel__grow" disabled>
              Download
            </button>
          )}
        </ClipPanelButtons>
      </ClipPanelFooter>
    </ClipPanel>
  );
}

/** V11b: no shorts yet. "Find moments" puts the cursor in the search bar. */
function Empty() {
  const focusSearch = useFocusSearch();
  return (
    <div className="mac-shorts__empty">
      <span className="mac-shorts__empty-icon">
        <Icon name="scissors" size="sm" />
      </span>
      <h2 className="mac-shorts__empty-title">No shorts yet</h2>
      <p className="mac-shorts__empty-body">
        Search for moments below, select the ones you like, and the editor cuts, captions and critiques a draft.
      </p>
      <span className="mac-shorts__empty-actions">
        <button
          type="button"
          className="mac-button mac-shorts__find"
          onClick={() => {
            focusSearch();
          }}
        >
          <Icon name="search" size="xs" />
          Find moments
        </button>
      </span>
      <span className="mac-shorts__empty-hint">Find moments puts the cursor in the search bar ↓</span>
    </div>
  );
}

/**
 * The page (`/shorts` in the Mac app).
 * @returns The page.
 */
export function MacShortsPage() {
  const { state, refresh } = useShortsList();
  const deletion = useDeleteShort();
  const [filter, setFilter] = useState<ShortsFilter>('all');
  const [picked, setPicked] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<ShortListItem | null>(null);
  const all = state.status === 'ready' ? [...state.data].sort((a, b) => b.created_at.localeCompare(a.created_at)) : [];
  const hasShorts = all.length > 0;
  const shown = filterShorts(all, filter);
  const selected = shown.find((item) => item.short_id === picked) ?? shown[0];
  const aside = hasShorts && selected !== undefined ? <Aside key={selected.short_id} item={selected} /> : undefined;
  return (
    <MacColumns asideLabel={ASIDE_LABEL} aside={aside}>
      <header className="mac-columns__head">
        <h1 className="mac-columns__title">{STUDIO_COPY.shorts}</h1>
        {hasShorts && <span className="mac-columns__sub">{shortsCountLine(all.length)}</span>}
      </header>
      {hasShorts && (
        <div className="mac-shorts__toolbar" role="group" aria-label="Show">
          {SHORTS_FILTERS.map((option) => (
            <MacChip
              key={option}
              isOn={option === filter}
              onClick={() => {
                setFilter(option);
              }}
            >
              {SHORTS_FILTER_LABEL[option]}
            </MacChip>
          ))}
        </div>
      )}
      <div className="mac-shorts__body">
        {state.status === 'loading' && (
          <div className="mac-shorts__list" aria-busy="true">
            <p className="visually-hidden" role="status">
              Loading shorts…
            </p>
            <Skeleton kind="line" />
            <Skeleton kind="line" />
          </div>
        )}
        {state.status === 'error' && <LoadError error={state.error} thing="shorts list" onRetry={refresh} />}
        {state.status === 'ready' && !hasShorts && <Empty />}
        {hasShorts && shown.length === 0 && <p className="mac-shorts__none">No shorts match this filter.</p>}
        {shown.length > 0 && (
          <ul className="mac-shorts__list">
            {shown.map((item) => (
              <Row
                key={item.short_id}
                item={item}
                isSelected={item.short_id === selected?.short_id}
                onSelect={setPicked}
                onDelete={setDeleting}
              />
            ))}
          </ul>
        )}
      </div>
      <MacConfirmDialog
        open={deleting !== null}
        copy={SHORT_DELETE_COPY}
        isBusy={deletion.isDeleting}
        onCancel={() => {
          setDeleting(null);
        }}
        onConfirm={() => {
          if (deleting === null) return;
          void deletion.remove(deleting.short_id).then((isDone) => {
            if (!isDone) return;
            setDeleting(null);
            refresh();
          });
        }}
      />
    </MacColumns>
  );
}
