// The cover controls of one platform's export, shared by the Mac and PWA Publish pages: the cover
// selected for the preview, the style for "Make 3 more", the title being typed, and the redraw
// words. Mount it per platform (key it by platform) so the drafts start fresh on each tab.
import { useState } from 'react';
import {
  addSuggestion,
  canMakeMoreCovers,
  canRedraw,
  canSaveTitle,
  clampCoverTitle,
  coverTiles,
  tileOverlay,
  titleOverlay,
  type CoverView,
} from '../core/publish';
import { CUTOUT_STYLE, type CoverChipStyle, type CoverTitlePosition, type CutoutBackground, type ExportItem } from '../services/api/types';
import type { ExportsHandle } from './useExports';

/** What the controls show and do. */
export interface CoverControls {
  tiles: CoverView[];
  /** The tile the preview and Redraw work on; undefined before any cover is drawn. */
  selected: CoverView | undefined;
  /** Selects a tile for the preview without saving it (Mac; Use this cover saves it). */
  select: (index: number) => void;
  /** Saves a tile as the platform's cover (the PWA tiles, Use this cover). */
  use: (index: number) => void;
  /** The title over the covers, live while typed; null when off. */
  overlay: ReturnType<typeof titleOverlay>;
  /** The title over one tile: none on a cutout cover (its title is drawn in). */
  overlayFor: (tile: CoverView) => ReturnType<typeof titleOverlay>;
  style: CoverChipStyle;
  setStyle: (style: CoverChipStyle) => void;
  canMore: boolean;
  /** Make 3 more, or with the Cutout chip, one cutout cover over `background`. */
  more: () => void;
  /** The cutout cover's background (board V21): the next cutout cover is made over it. */
  background: CutoutBackground;
  setBackground: (background: CutoutBackground) => void;
  /** The Cutout chip is on or a cutout cover is selected: show Background and How it is made. */
  isCutout: boolean;
  /** The title text as shown in its field. */
  titleText: string;
  typeTitle: (text: string) => void;
  /** Saves the typed text (on blur or Enter) when it changed and fits. */
  commitTitle: () => void;
  setShow: (show: boolean) => void;
  setPosition: (position: CoverTitlePosition) => void;
  words: string;
  setWords: (words: string) => void;
  suggest: (suggestion: string) => void;
  canRedraw: boolean;
  redraw: () => void;
  /** A redraw of this platform is in flight: its new tile shows "Redrawing…". */
  isRedrawing: boolean;
}

/**
 * Builds the controls for one export.
 * @param item - The platform's export.
 * @param handle - The pack's actions.
 * @param isBusy - A publish or cover run is in flight.
 * @returns The controls.
 */
export function useCoverControls(item: ExportItem, handle: ExportsHandle, isBusy: boolean): CoverControls {
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);
  const [usedIndex, setUsedIndex] = useState<number | null>(null);
  const [style, setStyle] = useState<CoverChipStyle>('bright');
  const [chosenBackground, setBackground] = useState<CutoutBackground | null>(null);
  const [titleDraft, setTitleDraft] = useState<string | null>(null);
  const [words, setWords] = useState('');
  const platform = item.platform;
  const saved = item.cover_title;

  const tiles = coverTiles(item.covers, usedIndex ?? item.cover_pick);
  const selected = tiles[selectedIndex ?? -1] ?? tiles.find((tile) => tile.isPicked);
  const use = (index: number) => {
    setUsedIndex(index);
    setSelectedIndex(index);
    void handle.edit(platform, { cover_pick: index }).then((ok) => {
      if (!ok) setUsedIndex(null);
    });
  };
  const saveTitle = (change: Partial<typeof saved>) => {
    void handle.saveTitle(platform, { ...saved, ...change });
  };
  const commitTitle = () => {
    if (titleDraft === null || !canSaveTitle(titleDraft, saved.text)) return;
    void handle.saveTitle(platform, { ...saved, text: titleDraft.trim() }).then((ok) => {
      if (ok) setTitleDraft(null);
    });
  };
  const isRedrawing = isBusy && handle.redrawing.has(platform);
  const overlay = titleOverlay(saved, titleDraft);
  const selectedCutout = selected?.style === CUTOUT_STYLE ? item.covers[selected.index] : undefined;
  // Until one is picked, the switch shows the selected cutout's background, else the default scene.
  const background = chosenBackground ?? selectedCutout?.background ?? 'scene';
  return {
    tiles,
    selected,
    select: setSelectedIndex,
    use,
    overlay,
    overlayFor: (tile) => tileOverlay(tile.style, overlay),
    style,
    setStyle,
    canMore: canMakeMoreCovers(item.covers.length, isBusy),
    more: () => {
      if (style === CUTOUT_STYLE) void handle.moreCovers(platform, style, background);
      else void handle.moreCovers(platform, style);
    },
    background,
    setBackground,
    isCutout: style === CUTOUT_STYLE || selectedCutout !== undefined,
    titleText: titleDraft ?? saved.text,
    typeTitle: (text) => {
      setTitleDraft(clampCoverTitle(text));
    },
    commitTitle,
    setShow: (show) => {
      saveTitle({ show });
    },
    setPosition: (position) => {
      saveTitle({ position });
    },
    words,
    setWords,
    suggest: (suggestion) => {
      setWords((text) => addSuggestion(text, suggestion));
    },
    canRedraw: selected !== undefined && canRedraw(words, item.covers.length, isBusy),
    redraw: () => {
      if (selected === undefined) return;
      void handle.redraw(platform, selected.index, words).then((ok) => {
        if (ok) setWords('');
      });
    },
    isRedrawing,
  };
}
