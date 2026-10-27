// Settings › Brand (the brand kit, moved here from its sheet on the Mac): three colours, the title
// font, the logo and the logo corner, beside a 9:16 cover preview. Each change saves on its own
// (`PUT /api/brand`) a moment after the last edit; the style references are kept as saved (they
// are edited from New production). Renders do not place a logo by corner yet, so the corner
// choice is disabled.
import { useEffect, useState } from 'react';
import { colorInSlot, setColorSlot } from '../../../core/brand-kit';
import { Icon } from '../../../design/Icon';
import { Skeleton } from '../../../design/Skeleton';
import { useBrandKit, type BrandKitHandle } from '../../../hooks/useBrandKit';
import type { BrandKit, TitleFont } from '../../../services/api/types';
import { starterColors } from '../../BrandKitSheet';
import { PickGroup, SettingRow, SettingsHeading } from './SettingsParts';

/** How long edits rest before they are saved. */
const SAVE_AFTER_MS = 600;

const SWATCHES = ['Main colour', 'Second colour', 'Text colour'] as const;

const FONTS: readonly { value: TitleFont; label: string }[] = [
  { value: 'bricolage', label: 'Bricolage Bold' },
  { value: 'geist', label: 'Geist Bold' },
];

const CORNERS = [
  { value: 'top-left', label: 'Top left' },
  { value: 'top-right', label: 'Top right' },
  { value: 'none', label: 'None' },
] as const;

/** The image types the kit takes. */
const IMAGE_TYPES = 'image/png,image/jpeg';

/** The preview's sample title. */
const SAMPLE_TITLE = 'Your title here';

/** The editable part of the kit. */
interface Draft {
  colors: string[];
  font: TitleFont;
  logoKey: string | null;
  logoUrl: string | null;
}

const draftOf = (kit: BrandKit | null, starters: readonly string[]): Draft => ({
  colors: kit?.colors ?? starters.slice(0, 1),
  font: kit?.title_font ?? 'bricolage',
  logoKey: kit?.logo_key ?? null,
  logoUrl: kit?.logo_url ?? null,
});

function CoverPreview({ draft, starters, refUrl }: { draft: Draft; starters: readonly string[]; refUrl: string | null }) {
  return (
    <figure className="mac-brand__figure">
      <span className="mac-brand__cover" style={refUrl === null ? undefined : { backgroundImage: `url("${refUrl}")` }}>
        {draft.logoUrl !== null && <img className="mac-brand__logo" src={draft.logoUrl} alt="" />}
        <span className="mac-brand__caption">
          <span className={`mac-brand__title mac-brand__title--${draft.font}`}>{SAMPLE_TITLE}</span>
          <span className="mac-brand__rule" style={{ background: colorInSlot(draft.colors, starters, 0) }} />
        </span>
      </span>
      <figcaption className="mac-set__muted">Cover preview, 9:16</figcaption>
    </figure>
  );
}

function Form({ kit, handle }: { kit: BrandKit | null; handle: BrandKitHandle }) {
  const [starters] = useState(starterColors);
  const [draft, setDraft] = useState<Draft>(() => draftOf(kit, starters));
  const [edits, setEdits] = useState(0);
  const { save, upload, isUploading } = handle;
  const refKeys = kit?.ref_keys;
  useEffect(() => {
    if (edits === 0) return undefined;
    const timer = setTimeout(() => {
      void save({ colors: draft.colors, title_font: draft.font, logo_key: draft.logoKey, ref_keys: refKeys ?? [] });
    }, SAVE_AFTER_MS);
    return () => {
      clearTimeout(timer);
    };
  }, [edits, draft, refKeys, save]);
  const edit = (patch: Partial<Draft>) => {
    setDraft((d) => ({ ...d, ...patch }));
    setEdits((n) => n + 1);
  };
  return (
    <div className="mac-brand">
      <div className="mac-brand__rows">
        <SettingRow title="Colours">
          <span className="mac-brand__swatches">
            {SWATCHES.map((label, index) => {
              const color = colorInSlot(draft.colors, starters, index);
              return (
                <label key={label} className="mac-brand__swatch" style={{ background: color }}>
                  <span className="visually-hidden">{`${label} ${color}`}</span>
                  <input
                    className="visually-hidden"
                    type="color"
                    value={color}
                    onChange={(event) => {
                      edit({ colors: setColorSlot(draft.colors, starters, index, event.target.value) });
                    }}
                  />
                </label>
              );
            })}
          </span>
        </SettingRow>
        <SettingRow title="Title font">
          <span className="mac-brand__select-wrap">
            <select
              className="mac-set__button mac-brand__select"
              aria-label="Title font"
              value={draft.font}
              onChange={(event) => {
                const font = FONTS.find((f) => f.value === event.target.value)?.value;
                if (font !== undefined) edit({ font });
              }}
            >
              {FONTS.map((font) => (
                <option key={font.value} value={font.value}>
                  {font.label}
                </option>
              ))}
            </select>
            <Icon name="chevron-down" size="xs" />
          </span>
        </SettingRow>
        <SettingRow title="Logo" hint={isUploading ? 'Uploading…' : 'PNG or JPG, shown in a corner'}>
          <label className="mac-set__button">
            Choose file…
            <input
              className="visually-hidden"
              type="file"
              accept={IMAGE_TYPES}
              onChange={(event) => {
                const file = event.target.files?.[0];
                event.target.value = '';
                if (file === undefined) return;
                void upload({ kind: 'logo' }, file).then((up) => {
                  if (up !== null) edit({ logoKey: up.key, logoUrl: up.previewUrl });
                });
              }}
            />
          </label>
        </SettingRow>
        <SettingRow title="Logo corner">
          <PickGroup label="Logo corner" options={CORNERS} value="top-right" disabled onChange={() => undefined} />
        </SettingRow>
      </div>
      <CoverPreview draft={draft} starters={starters} refUrl={kit?.ref_urls[0] ?? null} />
    </div>
  );
}

/**
 * The section; the kit loads when it opens.
 * @returns The section's rows.
 */
export function BrandSettings() {
  const handle = useBrandKit();
  return (
    <>
      <SettingsHeading
        title="Brand"
        lead="Your look on everything Studio makes: the colours, title font and logo on shorts, storyboard frames and Publish covers."
      />
      {handle.state.status === 'loading' && (
        <div aria-busy="true">
          <Skeleton kind="line" />
          <Skeleton kind="line-short" />
        </div>
      )}
      {handle.state.status === 'error' && <p className="mac-set__hint">Brand not available right now.</p>}
      {handle.state.status === 'ready' && <Form kit={handle.state.data.kit} handle={handle} />}
    </>
  );
}
