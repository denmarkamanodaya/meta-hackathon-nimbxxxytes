// The Gallery's toolbar row (redesign v2, Gallery V1): filter chips (the chosen one in accent text
// and border; Copies carries its count, Phase 29 V54), the sort menu, the grid/list switch (the chosen icon in accent) and the thumbnail
// size slider. The project page reuses the switch alone.
import {
  GALLERY_FILTER_LABEL,
  GALLERY_FILTERS,
  GALLERY_SIZE_MAX,
  GALLERY_SIZE_MIN,
  GALLERY_SORT_LABEL,
  GALLERY_SORTS,
  type GalleryFilter,
  type GallerySort,
  type GalleryView,
} from '../../core/gallery';
import { Icon } from '../../design/Icon';
import { Menu } from '../../design/Menu';
import { useMenu } from '../../hooks/useMenu';
import './GalleryToolbar.css';

/**
 * Grid and list buttons.
 * @param props - The view and its setter.
 * @returns The two buttons.
 */
export function ViewSwitch({ view, onView }: { view: GalleryView; onView: (next: GalleryView) => void }) {
  return (
    <span className="gallery-toolbar__views" role="group" aria-label="View">
      {(['grid', 'list'] as const).map((option) => (
        <button
          key={option}
          type="button"
          className={option === view ? 'gallery-toolbar__view gallery-toolbar__view--on' : 'gallery-toolbar__view'}
          aria-label={option === 'grid' ? 'Grid' : 'List'}
          aria-pressed={option === view}
          onClick={() => {
            onView(option);
          }}
        >
          <Icon name={option} size="sm" />
        </button>
      ))}
    </span>
  );
}

/** Props for `GalleryToolbar`. */
export interface GalleryToolbarProps {
  filter: GalleryFilter;
  onFilter: (next: GalleryFilter) => void;
  sort: GallerySort;
  onSort: (next: GallerySort) => void;
  view: GalleryView;
  onView: (next: GalleryView) => void;
  size: number;
  onSize: (next: number) => void;
  /** Duplicates and near-copies in the library: the Copies chip's count. */
  copies: number;
}

/**
 * The row.
 * @param props - See `GalleryToolbarProps`.
 * @returns The toolbar.
 */
export function GalleryToolbar({ filter, onFilter, sort, onSort, view, onView, size, onSize, copies }: GalleryToolbarProps) {
  const sortMenu = useMenu();
  return (
    <div className="gallery-toolbar">
      <div className="gallery-toolbar__chips" role="group" aria-label="Show">
        {GALLERY_FILTERS.map((option) => (
          <button
            key={option}
            type="button"
            aria-pressed={option === filter}
            className={option === filter ? 'gallery-toolbar__chip gallery-toolbar__chip--on' : 'gallery-toolbar__chip'}
            onClick={() => {
              onFilter(option);
            }}
          >
            {GALLERY_FILTER_LABEL[option]}
            {option === 'copies' && copies > 0 && <span className="gallery-toolbar__count">{copies}</span>}
          </button>
        ))}
      </div>
      <span className="gallery-toolbar__grow" />
      <button type="button" className="gallery-toolbar__sort" aria-haspopup="menu" onClick={sortMenu.openFromButton}>
        {GALLERY_SORT_LABEL[sort]}
        <Icon name="chevron-down" size="xs" />
      </button>
      <Menu
        anchor={sortMenu.anchor}
        label="Sort"
        onClose={sortMenu.close}
        items={GALLERY_SORTS.map((option) => ({
          kind: 'check',
          label: GALLERY_SORT_LABEL[option],
          isChecked: option === sort,
          onSelect: () => {
            onSort(option);
          },
        }))}
      />
      <span className="gallery-toolbar__divider" aria-hidden="true" />
      <ViewSwitch view={view} onView={onView} />
      <label className="gallery-toolbar__size">
        Size
        <input
          type="range"
          min={GALLERY_SIZE_MIN}
          max={GALLERY_SIZE_MAX}
          value={size}
          disabled={view === 'list'}
          aria-label="Thumbnail size"
          onChange={(event) => {
            onSize(Number(event.target.value));
          }}
        />
      </label>
    </div>
  );
}
