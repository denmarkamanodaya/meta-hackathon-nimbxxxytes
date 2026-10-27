// New production on the Mac (redesign v2, V12): "‹ Productions / New production" and its line;
// a 720 px form column with the brief, the "Start from" briefs, the Story and Short format cards,
// the Frame row (4:5 or 1:1), the Style row (the app's look or the saved brand kit, changed in
// Settings › Brand) and the Blur bystanders switch. The right column says what happens next and
// holds "Plan my shots", which starts the plan and opens the production.
import { useId, useState } from 'react';
import { MacChip } from '../../components/desktop/MacChip';
import { MacColumns, MacCrumb } from '../../components/desktop/MacColumns';
import { MacSettingsSheet } from '../../components/desktop/MacSettingsSheet';
import { PickGroup } from '../../components/desktop/settings/SettingsParts';
import { brandKitSummary } from '../../core/brand-kit';
import { FORMAT_COPY, PRODUCTION_COPY } from '../../core/copy';
import { BRIEF_PRESETS, MAX_BRIEF_CHARS } from '../../core/production-view';
import { Spinner } from '../../design/Spinner';
import { Toggle } from '../../design/Toggle';
import { useBrandKit } from '../../hooks/useBrandKit';
import { useNewProductionForm } from '../../hooks/useProductions';
import type { Aspect, ProductionFormat } from '../../services/api/types';
import '../../components/desktop/MacSettings.css';
import './MacNewProductionPage.css';

const FORMATS: readonly ProductionFormat[] = ['story', 'short'];

const ASPECTS: readonly { value: Aspect; label: string }[] = [
  { value: '4:5', label: '4:5' },
  { value: '1:1', label: '1:1' },
];

const STEPS: readonly { title: string; line: string }[] = [
  { title: 'Shot list', line: 'Muse Spark plans the shots in acts.' },
  { title: 'Storyboard', line: 'Muse Image draws one frame per shot.' },
  { title: 'Coverage', line: 'Your Gallery is checked for every shot; missing ones get filming tips.' },
];

function FormatCards({ value, onChange }: { value: ProductionFormat; onChange: (format: ProductionFormat) => void }) {
  return (
    <fieldset className="mac-new__formats">
      <legend className="mac-new__label mac-new__legend">Format</legend>
      <div className="mac-new__format-grid">
        {FORMATS.map((format) => {
          const copy = FORMAT_COPY[format];
          const isOn = format === value;
          return (
            <button
              key={format}
              type="button"
              className={isOn ? 'mac-new__format mac-new__format--on' : 'mac-new__format'}
              aria-pressed={isOn}
              onClick={() => {
                onChange(format);
              }}
            >
              <span className="mac-new__format-head">
                <span className="mac-new__format-name">{copy.name}</span>
                <span className="mac-new__format-range">{copy.range}</span>
              </span>
              <span className="mac-new__muted">{copy.line}</span>
            </button>
          );
        })}
      </div>
    </fieldset>
  );
}

/** "Style": the app's look or the saved kit, and the way to Settings › Brand. */
function StyleRow() {
  const brand = useBrandKit();
  const [isSettingsOpen, setSettingsOpen] = useState(false);
  const kit = brand.state.status === 'ready' ? brand.state.data.kit : null;
  const line = brand.state.status === 'loading' ? 'Loading your brand kit…' : kit === null ? 'App colours and fonts' : brandKitSummary(kit);
  return (
    <div className="mac-new__row mac-new__row--next">
      <span className="mac-new__row-text">
        <span className="mac-new__label">Style</span>
        <span className="mac-new__muted">{line}</span>
      </span>
      <button
        type="button"
        className="mac-new__link"
        onClick={() => {
          setSettingsOpen(true);
        }}
      >
        Change in Settings › Brand
      </button>
      {isSettingsOpen && (
        <MacSettingsSheet
          open
          initialSection="brand"
          onClose={() => {
            setSettingsOpen(false);
            brand.refresh();
          }}
        />
      )}
    </div>
  );
}

function WhatsNext({ canPlan, isCreating, onPlan }: { canPlan: boolean; isCreating: boolean; onPlan: () => void }) {
  return (
    <div className="mac-new__aside">
      <div className="mac-new__steps">
        <span className="mac-columns__label">What happens next</span>
        <ol className="mac-new__step-list">
          {STEPS.map((step, index) => (
            <li key={step.title} className="mac-new__step">
              <span className="mac-new__step-number">{index + 1}</span>
              <span className="mac-new__step-text">
                <span className="mac-new__label">{step.title}</span>
                <span className="mac-new__muted">{step.line}</span>
              </span>
            </li>
          ))}
        </ol>
        <p className="mac-new__muted mac-new__time">Takes about a minute.</p>
      </div>
      <div className="mac-new__footer">
        <button type="button" className="mac-button mac-button--primary mac-new__plan" disabled={!canPlan} onClick={onPlan}>
          {isCreating && <Spinner />}
          {PRODUCTION_COPY.planShots}
        </button>
      </div>
    </div>
  );
}

/**
 * The page (`/productions/new` in the Mac app).
 * @returns The page.
 */
export function MacNewProductionPage() {
  const form = useNewProductionForm();
  const briefId = useId();
  return (
    <MacColumns
      asideLabel="What happens next"
      aside={<WhatsNext canPlan={form.canPlan} isCreating={form.isCreating} onPlan={form.plan} />}
    >
      <header className="mac-columns__head mac-columns__head--crumb">
        <MacCrumb to="/productions" label={PRODUCTION_COPY.productions} />
        <h1 className="mac-columns__crumb-title">{PRODUCTION_COPY.newProduction}</h1>
        <span className="mac-columns__sub">Say what it is about. The planner writes the shot list.</span>
      </header>
      <div className="mac-new">
        <div className="mac-new__brief-group">
          <label className="mac-new__label" htmlFor={briefId}>
            What is it about?
          </label>
          <textarea
            id={briefId}
            className="mac-new__brief"
            rows={4}
            maxLength={MAX_BRIEF_CHARS}
            value={form.brief}
            onChange={(event) => {
              form.setBrief(event.target.value);
            }}
          />
        </div>
        <div className="mac-new__presets" role="group" aria-label="Start from">
          <span className="mac-new__presets-label">Start from</span>
          {BRIEF_PRESETS.map((preset) => (
            <MacChip
              key={preset.label}
              onClick={() => {
                form.setBrief(preset.brief);
              }}
            >
              {preset.label}
            </MacChip>
          ))}
        </div>
        <FormatCards value={form.format} onChange={form.setFormat} />
        <div className="mac-new__row mac-new__row--first">
          <span className="mac-new__row-text">
            <span className="mac-new__label">Frame</span>
            <span className="mac-new__muted">9:16 versions are made at publish.</span>
          </span>
          <PickGroup label="Frame" options={ASPECTS} value={form.aspect} onChange={form.setAspect} />
        </div>
        <StyleRow />
        <div className="mac-new__row mac-new__row--next">
          <span className="mac-new__row-text">
            <span className="mac-new__label">Blur bystanders</span>
            <span className="mac-new__muted">Faces you hid in Faces are blurred in previews and renders.</span>
          </span>
          <Toggle checked={form.blur} onChange={form.setBlur} label="Blur bystanders" />
        </div>
      </div>
    </MacColumns>
  );
}
