// Brand kit sheet (from Settings and New production): up to 3 colours (the first is the video
// accent), the title font, a logo and up to 4 style references (PNG or JPG up to 5 MB, uploaded
// straight to storage), then "Save brand kit". Renders and new covers follow the saved kit.
import { useState } from 'react';
import {
  addColor,
  canRemoveColor,
  freeRefSlot,
  isSavableColorList,
  MAX_BRAND_COLORS,
  MAX_BRAND_REFS,
  removeColor,
  replaceColor,
} from '../core/brand-kit';
import { PRODUCTION_COPY } from '../core/copy';
import { Button } from '../design/Button';
import { Icon } from '../design/Icon';
import { SegmentedControl } from '../design/SegmentedControl';
import { Sheet } from '../design/Sheet';
import { Skeleton } from '../design/Skeleton';
import { useBrandKit, type BrandKitHandle } from '../hooks/useBrandKit';
import type { BrandKit, TitleFont } from '../services/api/types';
import { FilePickerButton } from './FilePickerButton';
import './BrandKitSheet.css';

const IMAGE_TYPES = 'image/png,image/jpeg';

const FONT_OPTIONS = [
  { value: 'bricolage', label: 'Bricolage · bold' },
  { value: 'geist', label: 'Geist · clean' },
] as const;

/** An image of the kit: its storage key and something to show. */
interface KitImage {
  key: string;
  url: string | null;
}

/** The form's working copy of the kit. */
interface Draft {
  colors: string[];
  font: TitleFont;
  logo: KitImage | null;
  refs: KitImage[];
}

/** Tokens a new swatch starts from, in order: the app accent, the caption highlight, the ink. */
const STARTER_TOKENS = ['--accent', '--video-accent', '--color-text'] as const;

/**
 * The starter colours as `#rrggbb` values, read from the tokens so no colour is written twice.
 * Settings › Brand on the Mac starts its three swatches from these too.
 * @returns The colours that could be read.
 */
export function starterColors(): string[] {
  const style = getComputedStyle(document.documentElement);
  return STARTER_TOKENS.reduce<string[]>((list, token) => addColor(list, style.getPropertyValue(token)), []);
}

/**
 * The list with one more swatch: the first starter colour not listed yet (the owner then changes it).
 * @param colors - The current list.
 * @returns The new list.
 */
function withNewSwatch(colors: readonly string[]): string[] {
  const next = starterColors().find((c) => !colors.includes(c));
  return next === undefined ? [...colors] : addColor(colors, next);
}

function draftOf(kit: BrandKit | null): Draft {
  if (kit === null) return { colors: withNewSwatch([]), font: 'bricolage', logo: null, refs: [] };
  return {
    colors: kit.colors,
    font: kit.title_font,
    logo: kit.logo_key === null ? null : { key: kit.logo_key, url: kit.logo_url },
    refs: kit.ref_keys.map((key, i) => ({ key, url: kit.ref_urls[i] ?? null })),
  };
}

function Colors({ colors, onChange }: { colors: string[]; onChange: (colors: string[]) => void }) {
  return (
    <fieldset className="brand-kit__group">
      <legend className="brand-kit__label">Colours</legend>
      <p className="brand-kit__hint">Up to 3. Tap a swatch to change it. The first is the accent in your videos.</p>
      <div className="brand-kit__swatches">
        {colors.map((color, index) => (
          <span key={index} className="brand-kit__swatch-wrap">
            <label className="brand-kit__swatch" style={{ background: color }}>
              <span className="visually-hidden">{index === 0 ? `Accent colour ${color}` : `Colour ${String(index + 1)} ${color}`}</span>
              <input
                className="visually-hidden"
                type="color"
                value={color}
                onChange={(event) => {
                  onChange(replaceColor(colors, index, event.target.value));
                }}
              />
            </label>
            {index === 0 && <span className="brand-kit__accent-tag">Accent</span>}
            {canRemoveColor(colors) && (
              <button
                type="button"
                className="brand-kit__remove"
                aria-label={`Remove colour ${color}`}
                onClick={() => {
                  onChange(removeColor(colors, index));
                }}
              >
                <Icon name="close" size="xs" />
              </button>
            )}
          </span>
        ))}
        {colors.length < MAX_BRAND_COLORS && (
          <button
            type="button"
            className="brand-kit__swatch brand-kit__swatch--add"
            aria-label="Add a colour"
            onClick={() => {
              onChange(withNewSwatch(colors));
            }}
          >
            <Icon name="plus" size="sm" />
          </button>
        )}
      </div>
    </fieldset>
  );
}

function ImageTile({ image, alt, onRemove }: { image: KitImage; alt: string; onRemove: () => void }) {
  return (
    <span className="brand-kit__image">
      {image.url !== null && <img src={image.url} alt={alt} />}
      <button type="button" className="brand-kit__remove" aria-label={`Remove ${alt}`} onClick={onRemove}>
        <Icon name="close" size="xs" />
      </button>
    </span>
  );
}

function Form({ kit, handle, onSaved }: { kit: BrandKit | null; handle: BrandKitHandle; onSaved: () => void }) {
  const [draft, setDraft] = useState<Draft>(() => draftOf(kit));
  const slot = freeRefSlot(draft.refs.map((r) => r.key));
  const canSave = isSavableColorList(draft.colors) && !handle.isUploading && !handle.isSaving;
  return (
    <div className="brand-kit">
      <Colors
        colors={draft.colors}
        onChange={(colors) => {
          setDraft((d) => ({ ...d, colors }));
        }}
      />
      <div className="brand-kit__group">
        <span className="brand-kit__label">Title font</span>
        <SegmentedControl
          label="Title font"
          options={FONT_OPTIONS}
          value={draft.font}
          onChange={(font) => {
            setDraft((d) => ({ ...d, font }));
          }}
        />
      </div>
      <div className="brand-kit__group">
        <span className="brand-kit__label">Logo</span>
        <div className="brand-kit__images">
          {draft.logo !== null && (
            <ImageTile
              image={draft.logo}
              alt="Your logo"
              onRemove={() => {
                setDraft((d) => ({ ...d, logo: null }));
              }}
            />
          )}
          <FilePickerButton
            label={draft.logo === null ? 'Add logo' : 'Replace logo'}
            variant="dashed"
            size="md"
            accept={IMAGE_TYPES}
            multiple={false}
            onPick={([file]) => {
              if (file === undefined) return;
              void handle.upload({ kind: 'logo' }, file).then((up) => {
                if (up !== null) setDraft((d) => ({ ...d, logo: { key: up.key, url: up.previewUrl } }));
              });
            }}
          />
        </div>
        <p className="brand-kit__hint">PNG or JPG, up to 5 MB.</p>
      </div>
      <div className="brand-kit__group">
        <span className="brand-kit__label">Style references</span>
        <p className="brand-kit__hint">{`Up to ${String(MAX_BRAND_REFS)} images in your look. Covers and storyboards follow them.`}</p>
        <div className="brand-kit__images">
          {draft.refs.map((ref, index) => (
            <ImageTile
              key={ref.key}
              image={ref}
              alt={`Style reference ${String(index + 1)}`}
              onRemove={() => {
                setDraft((d) => ({ ...d, refs: d.refs.filter((r) => r.key !== ref.key) }));
              }}
            />
          ))}
          {slot !== null && (
            <FilePickerButton
              label="Add"
              variant="dashed"
              size="md"
              accept={IMAGE_TYPES}
              multiple={false}
              onPick={([file]) => {
                if (file === undefined) return;
                void handle.upload({ kind: 'ref', slot }, file).then((up) => {
                  if (up !== null) setDraft((d) => ({ ...d, refs: [...d.refs, { key: up.key, url: up.previewUrl }] }));
                });
              }}
            />
          )}
        </div>
      </div>
      {handle.isUploading && (
        <p className="brand-kit__hint" role="status">
          Uploading…
        </p>
      )}
      <Button
        size="lg"
        disabled={!canSave}
        onClick={() => {
          void handle
            .save({
              colors: draft.colors,
              title_font: draft.font,
              logo_key: draft.logo?.key ?? null,
              ref_keys: draft.refs.map((r) => r.key),
            })
            .then((saved) => {
              if (saved !== null) onSaved();
            });
        }}
      >
        {handle.isSaving ? 'Saving…' : PRODUCTION_COPY.saveBrandKit}
      </Button>
    </div>
  );
}

function Body({ onSaved }: { onSaved: () => void }) {
  const handle = useBrandKit();
  if (handle.state.status === 'loading') {
    return (
      <div aria-busy="true">
        <Skeleton kind="line" />
        <Skeleton kind="line-short" />
      </div>
    );
  }
  if (handle.state.status === 'error') return <p>{`${PRODUCTION_COPY.brandKit} is not available right now.`}</p>;
  return <Form kit={handle.state.data.kit} handle={handle} onSaved={onSaved} />;
}

/**
 * The Settings row that opens the Brand kit sheet.
 * @returns The row and its sheet.
 */
export function BrandKitRow() {
  const [isOpen, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        className="brand-row"
        onClick={() => {
          setOpen(true);
        }}
      >
        <span className="brand-row__text">
          <span className="brand-row__title">{PRODUCTION_COPY.brandKit}</span>
          <span className="brand-row__line">Colours, title font, logo and style for your videos and covers</span>
        </span>
        <Icon name="forward" size="sm" />
      </button>
      <BrandKitSheet
        open={isOpen}
        onClose={() => {
          setOpen(false);
        }}
      />
    </>
  );
}

/** Props for `BrandKitSheet`. */
export interface BrandKitSheetProps {
  open: boolean;
  onClose: () => void;
  /** After a save, with the sheet closing. */
  onSaved?: () => void;
}

/**
 * The sheet; the kit loads each time it opens.
 * @param props - See `BrandKitSheetProps`.
 * @returns The sheet.
 */
export function BrandKitSheet({ open, onClose, onSaved }: BrandKitSheetProps) {
  return (
    <Sheet open={open} onClose={onClose} title={PRODUCTION_COPY.brandKit}>
      {open && (
        <Body
          onSaved={() => {
            onSaved?.();
            onClose();
          }}
        />
      )}
    </Sheet>
  );
}
