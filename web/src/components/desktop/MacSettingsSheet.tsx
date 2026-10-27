// Settings in the Mac app (⌘, or the sidebar's Settings; redesign v2, V6): a window of its own over
// the app, with the section list on the left (General, Appearance, On this Mac, Faces and privacy,
// Brand, AI and cost, Account; the open one is accent text, no fill) and that section on the
// right. Esc, a click outside or the first window dot closes it.
import { useEffect, useId, useRef, useState, type ComponentType } from 'react';
import { AccountSettings } from './settings/AccountSettings';
import { AppearanceSettings } from './settings/AppearanceSettings';
import { BrandSettings } from './settings/BrandSettings';
import { CostSettings } from './settings/CostSettings';
import { FacesSettings } from './settings/FacesSettings';
import { GeneralSettings } from './settings/GeneralSettings';
import { MacStorageSettings } from './settings/MacStorageSettings';
import './MacSettings.css';

/** One section of the window. */
type SectionId = 'general' | 'appearance' | 'mac' | 'faces' | 'brand' | 'ai' | 'account';

const SECTIONS: readonly { id: SectionId; label: string }[] = [
  { id: 'general', label: 'General' },
  { id: 'appearance', label: 'Appearance' },
  { id: 'mac', label: 'On this Mac' },
  { id: 'faces', label: 'Faces and privacy' },
  { id: 'brand', label: 'Brand' },
  { id: 'ai', label: 'AI and cost' },
  { id: 'account', label: 'Account' },
];

const PANES: Readonly<Record<Exclude<SectionId, 'account'>, ComponentType>> = {
  general: GeneralSettings,
  appearance: AppearanceSettings,
  mac: MacStorageSettings,
  faces: FacesSettings,
  brand: BrandSettings,
  ai: CostSettings,
};

/** Props for `MacSettingsSheet`. */
export interface MacSettingsSheetProps {
  open: boolean;
  onClose: () => void;
}

/**
 * The Settings window.
 * @param props - See `MacSettingsSheetProps`.
 * @returns The dialog.
 */
export function MacSettingsSheet({ open, onClose }: MacSettingsSheetProps) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const [section, setSection] = useState<SectionId>('general');
  useEffect(() => {
    const dialog = ref.current;
    if (dialog === null) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);
  const Pane = section === 'account' ? null : PANES[section];
  return (
    <dialog
      ref={ref}
      className="mac-settings"
      aria-labelledby={titleId}
      onClose={onClose}
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className="mac-settings__window">
        <div className="mac-settings__titlebar">
          <span className="mac-settings__dots">
            <button type="button" className="mac-settings__dot" aria-label="Close settings" onClick={onClose} />
            <span className="mac-settings__dot" aria-hidden="true" />
            <span className="mac-settings__dot" aria-hidden="true" />
          </span>
          <h2 id={titleId} className="mac-settings__name">
            Settings
          </h2>
        </div>
        <div className="mac-settings__body">
          <nav className="mac-settings__nav" aria-label="Settings sections">
            {SECTIONS.map((item) => (
              <button
                key={item.id}
                type="button"
                className="mac-settings__section"
                aria-current={item.id === section ? 'page' : undefined}
                onClick={() => {
                  setSection(item.id);
                }}
              >
                {item.label}
              </button>
            ))}
          </nav>
          <section className="mac-settings__pane mac-set" aria-label={SECTIONS.find((s) => s.id === section)?.label}>
            {open && (Pane === null ? <AccountSettings onSignedOut={onClose} /> : <Pane />)}
          </section>
        </div>
      </div>
    </dialog>
  );
}
