// A letter's actions on the Mac, the iGuide pattern: "Rename…" opens the shared rename sheet,
// "Delete letter…" the red confirm. The letter page header's ⋯ shows the menu (deleting there opens
// the iRead list); an iRead list row shows the same menu on right-click.
import { useState } from 'react';
import { DOCUMENT_DELETE_COPY } from '../../core/delete-copy';
import { documentTitleProblem, IREAD_COPY } from '../../core/iread/documents';
import { Icon } from '../../design/Icon';
import { Menu, type MenuEntry } from '../../design/Menu';
import { useDeleteDocument, useRenameDocument } from '../../hooks/useDocuments';
import { useMenu } from '../../hooks/useMenu';
import { MacConfirmDialog } from './MacConfirmDialog';
import { MacDialog } from './MacDialog';
import { RenameForm } from './RenameForm';

/** The letter an action is for. */
export interface DocumentTarget {
  documentId: string;
  title: string;
}

/** Which dialog is open, and for which letter; null when none is. */
export type DocumentAsk = { kind: 'rename' | 'delete'; doc: DocumentTarget } | null;

/**
 * Rename… and Delete letter….
 * @param doc - The letter the menu is for.
 * @param ask - Opens the rename sheet or the delete confirm.
 * @returns The menu entries.
 */
export function documentMenuItems(doc: DocumentTarget, ask: (next: DocumentAsk) => void): MenuEntry[] {
  return [
    {
      kind: 'item',
      label: IREAD_COPY.renameDocument,
      onSelect: () => {
        ask({ kind: 'rename', doc });
      },
    },
    {
      kind: 'item',
      label: `${DOCUMENT_DELETE_COPY.confirmLabel}…`,
      isDanger: true,
      onSelect: () => {
        ask({ kind: 'delete', doc });
      },
    },
  ];
}

/** Props for `MacDocumentDialogs`. */
export interface MacDocumentDialogsProps {
  ask: DocumentAsk;
  onClose: () => void;
  /** Called after a rename is stored, to reload what shows the title. */
  onRenamed: () => void;
  /** Called after a delete succeeds (the iRead list is open by then). */
  onDeleted?: () => void;
}

function Rename({ doc, onClose, onRenamed }: { doc: DocumentTarget; onClose: () => void; onRenamed: () => void }) {
  const { rename, isSaving } = useRenameDocument(onRenamed);
  return (
    <RenameForm
      heading={IREAD_COPY.renameTitle}
      label={IREAD_COPY.titleField}
      initial={doc.title}
      problemOf={documentTitleProblem}
      isSaving={isSaving}
      onSave={(title) => rename(doc.documentId, title)}
      onClose={onClose}
    />
  );
}

/**
 * The rename sheet and the delete confirm for the letter being asked about.
 * @param props - See `MacDocumentDialogsProps`.
 * @returns The two dialogs.
 */
export function MacDocumentDialogs({ ask, onClose, onRenamed, onDeleted }: MacDocumentDialogsProps) {
  const { remove, isDeleting } = useDeleteDocument();
  return (
    <>
      <MacDialog open={ask?.kind === 'rename'} label={IREAD_COPY.renameTitle} onClose={onClose}>
        {ask?.kind === 'rename' && <Rename doc={ask.doc} onClose={onClose} onRenamed={onRenamed} />}
      </MacDialog>
      <MacConfirmDialog
        open={ask?.kind === 'delete'}
        copy={DOCUMENT_DELETE_COPY}
        isBusy={isDeleting}
        onCancel={onClose}
        onConfirm={() => {
          if (ask === null) return;
          void remove(ask.doc.documentId).then((isDeleted) => {
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
 * The letter page's ⋯ button, its menu and the dialogs.
 * @param props - The letter, and what to reload after a rename.
 * @returns The controls.
 */
export function MacDocumentOptions({ doc, onRenamed }: { doc: DocumentTarget; onRenamed: () => void }) {
  const menu = useMenu();
  const [ask, setAsk] = useState<DocumentAsk>(null);
  return (
    <>
      <button
        type="button"
        className="mac-button mac-button--head mac-button--icon"
        aria-label={`${IREAD_COPY.options}: Rename or delete`}
        aria-haspopup="menu"
        aria-expanded={menu.anchor !== null}
        onClick={menu.openFromButton}
      >
        <Icon name="more" size="xs" />
      </button>
      <Menu anchor={menu.anchor} label={IREAD_COPY.options} onClose={menu.close} className="mac-menu--narrow" items={documentMenuItems(doc, setAsk)} />
      <MacDocumentDialogs
        ask={ask}
        onClose={() => {
          setAsk(null);
        }}
        onRenamed={onRenamed}
      />
    </>
  );
}
