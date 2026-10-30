// A recording's actions on the Mac, the iRead pattern: "Rename…" opens the shared rename sheet,
// "Delete recording…" the red confirm. The recording page header's ⋯ shows the menu (deleting there
// opens the iListen list); an iListen list row shows the same menu on right-click.
import { useState } from 'react';
import { LISTEN_DELETE_COPY } from '../../core/delete-copy';
import { ILISTEN_COPY, listenTitleProblem } from '../../core/ilisten/listens';
import { Icon } from '../../design/Icon';
import { Menu, type MenuEntry } from '../../design/Menu';
import { useDeleteListen, useRenameListen } from '../../hooks/useListens';
import { useMenu } from '../../hooks/useMenu';
import { MacConfirmDialog } from './MacConfirmDialog';
import { MacDialog } from './MacDialog';
import { RenameForm } from './RenameForm';

/** The recording an action is for. */
export interface ListenTarget {
  listenId: string;
  title: string;
}

/** Which dialog is open, and for which recording; null when none is. */
export type ListenAsk = { kind: 'rename' | 'delete'; listen: ListenTarget } | null;

/**
 * Rename… and Delete recording….
 * @param listen - The recording the menu is for.
 * @param ask - Opens the rename sheet or the delete confirm.
 * @returns The menu entries.
 */
export function listenMenuItems(listen: ListenTarget, ask: (next: ListenAsk) => void): MenuEntry[] {
  return [
    {
      kind: 'item',
      label: ILISTEN_COPY.renameListen,
      onSelect: () => {
        ask({ kind: 'rename', listen });
      },
    },
    {
      kind: 'item',
      label: `${LISTEN_DELETE_COPY.confirmLabel}…`,
      isDanger: true,
      onSelect: () => {
        ask({ kind: 'delete', listen });
      },
    },
  ];
}

/** Props for `MacListenDialogs`. */
export interface MacListenDialogsProps {
  ask: ListenAsk;
  onClose: () => void;
  onRenamed: () => void;
  onDeleted?: () => void;
}

function Rename({ listen, onClose, onRenamed }: { listen: ListenTarget; onClose: () => void; onRenamed: () => void }) {
  const { rename, isSaving } = useRenameListen(onRenamed);
  return (
    <RenameForm
      heading={ILISTEN_COPY.renameTitle}
      label={ILISTEN_COPY.titleField}
      initial={listen.title}
      problemOf={listenTitleProblem}
      isSaving={isSaving}
      onSave={(title) => rename(listen.listenId, title)}
      onClose={onClose}
    />
  );
}

/**
 * The rename sheet and the delete confirm for the recording being asked about.
 * @param props - See `MacListenDialogsProps`.
 * @returns The two dialogs.
 */
export function MacListenDialogs({ ask, onClose, onRenamed, onDeleted }: MacListenDialogsProps) {
  const { remove, isDeleting } = useDeleteListen();
  return (
    <>
      <MacDialog open={ask?.kind === 'rename'} label={ILISTEN_COPY.renameTitle} onClose={onClose}>
        {ask?.kind === 'rename' && <Rename listen={ask.listen} onClose={onClose} onRenamed={onRenamed} />}
      </MacDialog>
      <MacConfirmDialog
        open={ask?.kind === 'delete'}
        copy={LISTEN_DELETE_COPY}
        isBusy={isDeleting}
        onCancel={onClose}
        onConfirm={() => {
          if (ask === null) return;
          void remove(ask.listen.listenId).then((isDeleted) => {
            if (!isDeleted) return;
            onClose();
            onDeleted?.();
          });
        }}
      />
    </>
  );
}

/**
 * The recording page's ⋯ button, its menu and the dialogs.
 * @param props - The recording, and what to reload after a rename.
 * @returns The controls.
 */
export function MacListenOptions({ listen, onRenamed }: { listen: ListenTarget; onRenamed: () => void }) {
  const menu = useMenu();
  const [ask, setAsk] = useState<ListenAsk>(null);
  return (
    <>
      <button
        type="button"
        className="mac-button mac-button--head mac-button--icon"
        aria-label={`${ILISTEN_COPY.options}: Rename or delete`}
        aria-haspopup="menu"
        aria-expanded={menu.anchor !== null}
        onClick={menu.openFromButton}
      >
        <Icon name="more" size="xs" />
      </button>
      <Menu anchor={menu.anchor} label={ILISTEN_COPY.options} onClose={menu.close} className="mac-menu--narrow" items={listenMenuItems(listen, setAsk)} />
      <MacListenDialogs
        ask={ask}
        onClose={() => {
          setAsk(null);
        }}
        onRenamed={onRenamed}
      />
    </>
  );
}
