// "Rename production…" in a production's ⋯ menu (the Productions list row and the production
// page): the shared rename form with the production's title, in any status.
import { MAC_STUDIO_COPY } from '../../core/copy';
import { productionTitleProblem } from '../../core/production-view';
import { useRenameProduction } from '../../hooks/useProductions';
import { MacDialog } from './MacDialog';
import { RenameForm } from './RenameForm';

/** The production a rename sheet is open for. */
export interface ProductionToRename {
  productionId: string;
  title: string;
}

/** Props for `RenameProductionSheet`. */
export interface RenameProductionSheetProps {
  /** The production to rename; null keeps the sheet closed. */
  target: ProductionToRename | null;
  onClose: () => void;
  /** Called after the title is stored, to reload what shows it. */
  onRenamed: () => void;
}

function Form({ target, onClose, onRenamed }: Omit<RenameProductionSheetProps, 'target'> & { target: ProductionToRename }) {
  const { rename, isSaving } = useRenameProduction(onRenamed);
  return (
    <RenameForm
      heading={MAC_STUDIO_COPY.renameProductionTitle}
      label={MAC_STUDIO_COPY.productionTitleField}
      initial={target.title}
      problemOf={productionTitleProblem}
      isSaving={isSaving}
      onSave={(title) => rename(target.productionId, title)}
      onClose={onClose}
    />
  );
}

/**
 * The sheet.
 * @param props - See `RenameProductionSheetProps`.
 * @returns The dialog.
 */
export function RenameProductionSheet({ target, onClose, onRenamed }: RenameProductionSheetProps) {
  return (
    <MacDialog open={target !== null} label={MAC_STUDIO_COPY.renameProductionTitle} onClose={onClose}>
      {target !== null && <Form target={target} onClose={onClose} onRenamed={onRenamed} />}
    </MacDialog>
  );
}
