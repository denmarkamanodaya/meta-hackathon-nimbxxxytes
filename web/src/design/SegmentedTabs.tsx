// SegmentedTabs primitive: the segmented control's look for switching between views (the PWA's
// Guides | Shorts, the Publish platforms), as a tab list. Picking a value in a form stays a
// SegmentedControl (radio group).
import { useRef, type KeyboardEvent } from 'react';
import type { SegmentOption } from './SegmentedControl';
import './SegmentedControl.css';

/** Props for `SegmentedTabs`. */
export interface SegmentedTabsProps<T extends string> {
  /** Accessible name of the tab list. */
  label: string;
  options: readonly SegmentOption<T>[];
  value: T;
  onChange: (value: T) => void;
  /** Id of the panel the tabs control, when there is one. */
  panelId?: string;
  /** `segmented` (default) draws the pill track; `underline` the Mac right column's text tabs
   * (accent text and a 2 px accent underline on the chosen one). Looks only; keys work the same. */
  look?: 'segmented' | 'underline';
}

/**
 * Tabs with roving focus: Tab reaches the selected one, arrow keys, Home and End move and select.
 * @param props - See `SegmentedTabsProps`.
 * @returns The tab list.
 */
export function SegmentedTabs<T extends string>({ label, options, value, onChange, panelId, look = 'segmented' }: SegmentedTabsProps<T>) {
  const refs = useRef(new Map<T, HTMLButtonElement>());
  const onKeyDown = (event: KeyboardEvent) => {
    const at = options.findIndex((o) => o.value === value);
    const last = options.length - 1;
    const next =
      event.key === 'ArrowRight' ? (at >= last ? 0 : at + 1)
      : event.key === 'ArrowLeft' ? (at <= 0 ? last : at - 1)
      : event.key === 'Home' ? 0
      : event.key === 'End' ? last
      : null;
    const option = next === null ? undefined : options[next];
    if (option === undefined) return;
    event.preventDefault();
    onChange(option.value);
    refs.current.get(option.value)?.focus();
  };
  return (
    <div className={look === 'underline' ? 'underline-tabs' : 'segmented segmented--tabs'} role="tablist" aria-label={label} onKeyDown={onKeyDown}>
      {options.map((option) => {
        const isOn = option.value === value;
        return (
          <button
            key={option.value}
            ref={(node) => {
              if (node === null) refs.current.delete(option.value);
              else refs.current.set(option.value, node);
            }}
            type="button"
            role="tab"
            aria-selected={isOn}
            aria-controls={panelId}
            tabIndex={isOn ? 0 : -1}
            className={look === 'underline' ? `underline-tabs__tab${isOn ? ' underline-tabs__tab--on' : ''}` : `segmented__option${isOn ? ' segmented__option--on' : ''}`}
            onClick={() => {
              onChange(option.value);
            }}
          >
            {option.label}
            {option.count !== undefined && <span className="underline-tabs__count">{option.count}</span>}
          </button>
        );
      })}
    </div>
  );
}
