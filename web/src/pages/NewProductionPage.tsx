// New production (`/productions/new`): the brief (prefilled from a preset), the format, the frame,
// the brand style with Edit (the Brand kit sheet), the blur switch, and "Plan my shots", which
// starts the plan and opens the production.
import { useId, useState } from 'react';
import { useNavigate } from 'react-router';
import { BackHeader } from '../components/BackHeader';
import { BrandKitSheet } from '../components/BrandKitSheet';
import { FORMAT_COPY, PRODUCTION_COPY } from '../core/copy';
import { BRIEF_PRESETS, DEFAULT_TARGET_S } from '../core/production-view';
import { BottomBar } from '../design/BottomBar';
import { Button } from '../design/Button';
import { Chip } from '../design/Chip';
import { SegmentedControl } from '../design/SegmentedControl';
import { Spinner } from '../design/Spinner';
import { SwitchRow } from '../design/SwitchRow';
import { useBrandKit } from '../hooks/useBrandKit';
import { useDesktopSlots } from '../hooks/desktop-slots';
import { useCreateProduction } from '../hooks/useProductions';
import type { Aspect, ProductionFormat } from '../services/api/types';
import './NewProductionPage.css';

/** Longest brief, characters (the server's limit). */
const MAX_BRIEF = 1000;

const FORMATS: readonly ProductionFormat[] = ['story', 'short'];

const ASPECTS = [
  { value: '4:5', label: '4:5' },
  { value: '1:1', label: '1:1' },
] as const;

const FONT_NAME = { bricolage: 'Bricolage, bold', geist: 'Geist, clean' } as const;

function FormatCards({ value, onChange }: { value: ProductionFormat; onChange: (f: ProductionFormat) => void }) {
  const name = useId();
  return (
    <fieldset className="new-production__group">
      <legend className="new-production__label">Format</legend>
      <div className="new-production__formats">
        {FORMATS.map((format) => {
          const copy = FORMAT_COPY[format];
          const isOn = format === value;
          return (
            <label key={format} className={`format-card${isOn ? ' format-card--on' : ''}`}>
              <input
                className="visually-hidden"
                type="radio"
                name={name}
                checked={isOn}
                onChange={() => {
                  onChange(format);
                }}
              />
              <span className="format-card__name">{copy.name}</span>
              <span className="format-card__range">{copy.range}</span>
              <span className="format-card__line">{copy.line}</span>
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}

function StyleRow() {
  const brand = useBrandKit();
  const [isEditing, setEditing] = useState(false);
  const kit = brand.state.status === 'ready' ? brand.state.data.kit : null;
  const line =
    brand.state.status === 'loading' ? 'Loading your brand kit…'
    : kit === null ? 'App colours and fonts. Add your own brand kit.'
    : `${FONT_NAME[kit.title_font]} titles${kit.logo_key === null ? '' : ' · logo'}`;
  return (
    <div className="new-production__group">
      <span className="new-production__label">Style</span>
      <div className="style-row">
        {kit !== null && (
          <span className="brand-swatches" aria-label={`Brand colours ${kit.colors.join(', ')}`}>
            {kit.colors.map((color) => (
              <span key={color} className="brand-swatches__dot" style={{ background: color }} />
            ))}
          </span>
        )}
        <span className="style-row__line">{line}</span>
        <Button
          variant="ghost"
          onClick={() => {
            setEditing(true);
          }}
        >
          Edit
        </Button>
      </div>
      <BrandKitSheet
        open={isEditing}
        onClose={() => {
          setEditing(false);
        }}
        onSaved={brand.refresh}
      />
    </div>
  );
}

/**
 * The page.
 * @returns The New production form.
 */
export function NewProductionPage() {
  const navigate = useNavigate();
  const isMac = useDesktopSlots() !== null;
  const { create, isCreating } = useCreateProduction();
  const briefId = useId();
  const [brief, setBrief] = useState(BRIEF_PRESETS[0]?.brief ?? '');
  const [format, setFormat] = useState<ProductionFormat>('story');
  const [aspect, setAspect] = useState<Aspect>('4:5');
  const [blur, setBlur] = useState(true);
  const canPlan = brief.trim() !== '' && !isCreating;

  return (
    <div className="new-production">
      <BackHeader
        title={PRODUCTION_COPY.newProduction}
        subtitle="Say what it is about. The planner writes the shot list."
        fallback={isMac ? '/productions' : '/shorts'}
      />
      <div className="new-production__group">
        <label className="new-production__label" htmlFor={briefId}>
          What is it about?
        </label>
        <textarea
          id={briefId}
          className="new-production__brief"
          rows={4}
          maxLength={MAX_BRIEF}
          value={brief}
          onChange={(event) => {
            setBrief(event.target.value);
          }}
        />
        <div className="new-production__presets" aria-label="Start from">
          {BRIEF_PRESETS.map((preset) => (
            <Chip
              key={preset.label}
              onClick={() => {
                setBrief(preset.brief);
              }}
            >
              {preset.label}
            </Chip>
          ))}
        </div>
      </div>
      <FormatCards value={format} onChange={setFormat} />
      <div className="new-production__group">
        <span className="new-production__label">Frame</span>
        <SegmentedControl label="Frame" options={ASPECTS} value={aspect} onChange={setAspect} />
        <p className="new-production__hint">9:16 versions are made at publish.</p>
      </div>
      <StyleRow />
      <SwitchRow
        title="Blur bystanders"
        description="Faces you hid in People are blurred in previews and renders."
        checked={blur}
        onChange={setBlur}
      />
      <BottomBar note={PRODUCTION_COPY.planNote}>
        <Button
          size="lg"
          disabled={!canPlan}
          onClick={() => {
            void create({ brief: brief.trim(), format, aspect, target_s: DEFAULT_TARGET_S[format], blur_bystanders: blur }).then(
              (id) => {
                if (id !== null) void navigate(`/productions/${encodeURIComponent(id)}`, { replace: true });
              },
            );
          }}
        >
          {isCreating && <Spinner />}
          {PRODUCTION_COPY.planShots}
        </Button>
      </BottomBar>
    </div>
  );
}
