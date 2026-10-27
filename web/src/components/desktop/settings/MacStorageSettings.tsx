// Settings › On this Mac: the space the drive uses against its cap, "Most space to use" (the cap,
// saved through `set_cache_budget`), how long played parts stay, the clips kept offline with
// Remove, and "Free up space now", which has no native command yet and so is disabled.
import { useEffect, useState } from 'react';
import { spaceUsedLabel, type SyncStatus } from '../../../core/desktop-sync';
import { onThisMacView } from '../../../core/on-this-mac';
import { useClips } from '../../../hooks/useClips';
import { useCacheBudget, useKeepOffline, useSyncStatus } from '../../../hooks/useDesktop';
import { useNow } from '../../../hooks/useNow';
import { SettingRow, SettingsHeading } from './SettingsParts';

/** The slider's range, GB (the mock's). */
const MIN_GB = 1;
const MAX_GB = 50;
/** How long the slider rests before the cap is saved. */
const SAVE_AFTER_MS = 400;
/** The release countdown does not show here, so the view only needs a slow clock. */
const TICK_MS = 30_000;
const BYTES_PER_GB = 1e9;

function SpaceLimit({ capBytes }: { capBytes: number }) {
  const setBudget = useCacheBudget();
  const capGb = Math.min(MAX_GB, Math.max(MIN_GB, Math.round(capBytes / BYTES_PER_GB)));
  const [draft, setDraft] = useState<number | null>(null);
  if (draft !== null && draft === capGb) setDraft(null);
  useEffect(() => {
    if (draft === null) return undefined;
    const timer = setTimeout(() => {
      setBudget(draft);
    }, SAVE_AFTER_MS);
    return () => {
      clearTimeout(timer);
    };
  }, [draft, setBudget]);
  const shown = draft ?? capGb;
  return (
    <SettingRow title="Most space to use" hint="Uses less when your disk is under 15% free">
      <input
        className="mac-set__range"
        type="range"
        min={MIN_GB}
        max={MAX_GB}
        value={shown}
        aria-label="Most space to use"
        aria-valuetext={`${String(shown)} GB`}
        onChange={(event) => {
          setDraft(Number(event.target.value));
        }}
      />
      <span className="mac-set__mono mac-set__value">{`${String(shown)} GB`}</span>
    </SettingRow>
  );
}

function Body({ status }: { status: SyncStatus }) {
  const now = useNow(TICK_MS);
  const view = onThisMacView(status, now);
  const keep = useKeepOffline();
  const { state } = useClips();
  const clips = state.status === 'ready' ? state.data : [];
  const usedPercent = status.cacheCapBytes > 0 ? Math.min(100, (status.cacheBytes / status.cacheCapBytes) * 100) : 0;
  const cap = status.cacheCapBytes > 0 ? ` of ${spaceUsedLabel(status.cacheCapBytes)}` : '';
  const minutes = `${String(view.releaseMinutes)} ${view.releaseMinutes === 1 ? 'minute' : 'minutes'}`;
  return (
    <>
      <div className="mac-set__block">
        <div className="mac-set__split">
          <span className="mac-set__row-title">Space used</span>
          <span className="mac-set__secondary">{`${view.spaceUsed}${cap}`}</span>
        </div>
        <span className="mac-set__bar" aria-hidden="true">
          <span className="mac-set__bar-fill" style={{ width: `${String(usedPercent)}%` }} />
        </span>
      </div>
      <SpaceLimit capBytes={status.cacheCapBytes} />
      <SettingRow title="Free played parts after" hint="Time since the last play">
        <span className="mac-set__secondary mac-set__small">{minutes}</span>
      </SettingRow>
      <div className="mac-set__block mac-set__block--tight">
        <div className="mac-set__row-title">Kept offline</div>
        {view.kept.length === 0 ? (
          <span className="mac-set__hint">Nothing kept offline. Right-click a clip › Keep on this Mac.</span>
        ) : (
          <ul className="mac-set__kept">
            {view.kept.map((kept) => {
              const clip = clips.find((c) => c.clip_id === kept.clipId);
              return (
                <li key={kept.clipId} className="mac-set__kept-row">
                  <span className="mac-set__kept-thumb">{clip?.thumb_url != null && <img src={clip.thumb_url} alt="" />}</span>
                  <span className="mac-set__kept-title">{clip?.title ?? kept.clipId}</span>
                  <span className="mac-set__muted">{kept.bytes > 0 ? spaceUsedLabel(kept.bytes) : 'Downloading…'}</span>
                  <button
                    type="button"
                    className="mac-set__button mac-set__button--quiet mac-set__button--sm"
                    onClick={() => {
                      keep(kept.clipId, false);
                    }}
                  >
                    Remove
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
      <div className="mac-set__foot">
        <button type="button" className="mac-set__button mac-set__button--md" disabled>
          Free up space now
        </button>
      </div>
    </>
  );
}

/**
 * The section.
 * @returns The section's rows.
 */
export function MacStorageSettings() {
  const { state } = useSyncStatus();
  return (
    <>
      <SettingsHeading title="On this Mac" lead="Clips stay in the cloud. Only the parts you play are kept here, then freed." />
      {state.status === 'ready' && <Body status={state.data} />}
      {state.status === 'error' && <p className="mac-set__hint">What is on this Mac is not available right now.</p>}
    </>
  );
}
