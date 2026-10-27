// A short's ⋯ button and menu (mock V4), on the Short page header and on each Shorts list row:
// the page's own actions (Export 1080p, Adjust cut) when it has them, then "Delete short…" behind
// the confirm sheet ("Delete this short? Its drafts and render are removed. The clips it used
// stay.").
import { useState } from 'react';
import { SHORT_DELETE_COPY } from '../core/delete-copy';
import { ConfirmSheet } from '../design/ConfirmSheet';
import { Menu, type MenuEntry } from '../design/Menu';
import { MoreButton } from '../design/MoreButton';
import { useDeleteShorts } from '../hooks/useDelete';
import { useMenu } from '../hooks/useMenu';
import { useServices } from '../hooks/services-context';

/** Props for `ShortMenu`. */
export interface ShortMenuProps {
  shortId: string;
  /** Items above the separator; none on a list row. */
  actions: MenuEntry[];
  /** After the short is gone (the toast is already shown). */
  onDeleted: () => void;
  /** The button's look: on a card or header (default), or over a preview. */
  tone?: 'surface' | 'overlay';
}

/**
 * The button, its menu and the delete sheet.
 * @param props - See `ShortMenuProps`.
 * @returns The controls.
 */
export function ShortMenu({ shortId, actions, onDeleted, tone = 'surface' }: ShortMenuProps) {
  const { toasts } = useServices();
  const menu = useMenu();
  const deletion = useDeleteShorts();
  const [isConfirming, setConfirming] = useState(false);
  const items: MenuEntry[] = [
    ...actions,
    ...(actions.length > 0 ? [{ kind: 'separator' } as const] : []),
    {
      kind: 'item',
      label: 'Delete short…',
      isDanger: true,
      onSelect: () => {
        setConfirming(true);
      },
    },
  ];
  return (
    <>
      <MoreButton tone={tone} isOpen={menu.anchor !== null} onClick={menu.openFromButton} />
      <Menu anchor={menu.anchor} label="Short actions" items={items} onClose={menu.close} />
      <ConfirmSheet
        open={isConfirming}
        {...SHORT_DELETE_COPY}
        busyLabel="Deleting…"
        isBusy={deletion.isDeleting}
        onCancel={() => {
          setConfirming(false);
        }}
        onConfirm={() => {
          void deletion.run([shortId]).then((outcome) => {
            if (outcome.failed.length > 0) {
              toasts.error('Could not delete the short', outcome.firstError);
              return;
            }
            setConfirming(false);
            toasts.info('Short deleted', '');
            onDeleted();
          });
        }}
      />
    </>
  );
}
