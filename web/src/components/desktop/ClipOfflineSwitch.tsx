// Mac app clip page switch: keep the clip's full original in ~/nimbytes/Originals (pinned, never
// evicted), or let the cache manage it.
import { SwitchRow } from '../../design/SwitchRow';
import { useClipOffline } from '../../hooks/useDesktop';

/**
 * The switch.
 * @param props - The clip id.
 * @returns The row.
 */
export function ClipOfflineSwitch({ clipId }: { clipId: string }) {
  const { isPinned, isSaving, setPinned } = useClipOffline(clipId);
  return (
    <SwitchRow
      title="Make available offline"
      description="Keeps the full original in ~/nimbytes/Originals for your editing app."
      checked={isPinned === true}
      disabled={isPinned === null || isSaving}
      onChange={(checked) => {
        void setPinned(checked);
      }}
    />
  );
}
