// A guide's actions on the Mac (the production pattern, V10a/V10b): "Rename guide…" opens the
// shared rename sheet; "Delete guide…" opens the red confirm. The guide page header's ⋯ shows the
// menu (deleting there opens the Guides list in place of the guide); a Guides list row shows the
// same menu on right-click.
import { useState } from 'react';
import { GUIDE_DELETE_COPY } from '../../core/delete-copy';
import { GUIDE_COPY, guideTitleProblem } from '../../core/guides';
import { Icon } from '../../design/Icon';
import { Menu, type MenuEntry } from '../../design/Menu';
import { useDeleteGuide, useRenameGuide } from '../../hooks/useGuides';
import { useMenu } from '../../hooks/useMenu';
import { MacConfirmDialog } from './MacConfirmDialog';
import { MacDialog } from './MacDialog';
import { RenameForm } from './RenameForm';

/** The ⋯ button's and the menu's name. */
const OPTIONS_LABEL = 'iGuide options';

/** The guide an action is for. */
export interface GuideTarget {
  guideId: string;
  title: string;
}

/** Which dialog is open, and for which guide; null when none is. */
export type GuideAsk = { kind: 'rename' | 'delete'; guide: GuideTarget } | null;

/**
 * Rename guide… and Delete guide….
 * @param guide - The guide the menu is for.
 * @param ask - Opens the rename sheet or the delete confirm.
 * @returns The menu entries.
 */
export function guideMenuItems(guide: GuideTarget, ask: (next: GuideAsk) => void): MenuEntry[] {
  return [
    {
      kind: 'item',
      label: GUIDE_COPY.renameGuide,
      onSelect: () => {
        ask({ kind: 'rename', guide });
      },
    },
    {
      kind: 'item',
      label: `${GUIDE_DELETE_COPY.confirmLabel}…`,
      isDanger: true,
      onSelect: () => {
        ask({ kind: 'delete', guide });
      },
    },
  ];
}

/** Props for `MacGuideDialogs`. */
export interface MacGuideDialogsProps {
  ask: GuideAsk;
  onClose: () => void;
  /** Called after a rename is stored, to reload what shows the title. */
  onRenamed: () => void;
  /** Called after a delete succeeds (the Guides list is open by then). */
  onDeleted?: () => void;
}

function RenameGuide({ guide, onClose, onRenamed }: { guide: GuideTarget; onClose: () => void; onRenamed: () => void }) {
  const { rename, isSaving } = useRenameGuide(onRenamed);
  return (
    <RenameForm
      heading={GUIDE_COPY.renameTitle}
      label={GUIDE_COPY.titleField}
      initial={guide.title}
      problemOf={guideTitleProblem}
      isSaving={isSaving}
      onSave={(title) => rename(guide.guideId, title)}
      onClose={onClose}
    />
  );
}

/**
 * The rename sheet and the delete confirm for the guide being asked about.
 * @param props - See `MacGuideDialogsProps`.
 * @returns The two dialogs.
 */
export function MacGuideDialogs({ ask, onClose, onRenamed, onDeleted }: MacGuideDialogsProps) {
  const { remove, isDeleting } = useDeleteGuide();
  return (
    <>
      <MacDialog open={ask?.kind === 'rename'} label={GUIDE_COPY.renameTitle} onClose={onClose}>
        {ask?.kind === 'rename' && <RenameGuide guide={ask.guide} onClose={onClose} onRenamed={onRenamed} />}
      </MacDialog>
      <MacConfirmDialog
        open={ask?.kind === 'delete'}
        copy={GUIDE_DELETE_COPY}
        isBusy={isDeleting}
        onCancel={onClose}
        onConfirm={() => {
          if (ask === null) return;
          void remove(ask.guide.guideId).then((isDeleted) => {
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
 * The guide page's ⋯ button, its menu and the dialogs.
 * @param props - The guide, and what to reload after a rename.
 * @returns The controls.
 */
export function MacGuideOptions({ guide, onRenamed }: { guide: GuideTarget; onRenamed: () => void }) {
  const menu = useMenu();
  const [ask, setAsk] = useState<GuideAsk>(null);
  return (
    <>
      <button
        type="button"
        className="mac-button mac-button--head mac-button--icon"
        aria-label={`${OPTIONS_LABEL}: Rename or delete iGuide`}
        aria-haspopup="menu"
        aria-expanded={menu.anchor !== null}
        onClick={menu.openFromButton}
      >
        <Icon name="more" size="xs" />
      </button>
      <Menu anchor={menu.anchor} label={OPTIONS_LABEL} onClose={menu.close} className="mac-menu--narrow" items={guideMenuItems(guide, setAsk)} />
      <MacGuideDialogs
        ask={ask}
        onClose={() => {
          setAsk(null);
        }}
        onRenamed={onRenamed}
      />
    </>
  );
}
