// Settings in the Mac app (⌘, or the sidebar's Settings): the shared settings (AI cost, face
// matching, how faces are handled) plus Appearance, and a sign-out that also clears the Keychain
// session and stops syncing.
import { useSyncActions } from '../../hooks/useDesktop';
import { SettingsSheet } from '../SettingsSheet';
import { AppearanceSetting } from './AppearanceSetting';

/** Props for `MacSettingsSheet`. */
export interface MacSettingsSheetProps {
  open: boolean;
  onClose: () => void;
}

/**
 * The sheet.
 * @param props - See `MacSettingsSheetProps`.
 * @returns The sheet.
 */
export function MacSettingsSheet({ open, onClose }: MacSettingsSheetProps) {
  const { signOut, isSigningOut } = useSyncActions();
  return (
    <SettingsSheet
      open={open}
      onClose={onClose}
      title="Settings"
      extra={<AppearanceSetting />}
      signOut={{ signOut, isSigningOut }}
    />
  );
}
