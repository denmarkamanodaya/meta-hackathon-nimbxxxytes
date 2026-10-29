// Rename on the phone: the shared rename sheet with the guide's title and words.
import { GUIDE_COPY, guideTitleProblem } from '../core/guides';
import type { RenameGuide } from '../hooks/useGuides';
import { RenameSheet } from './RenameSheet';

/** Props for `GuideRenameSheet`. */
export interface GuideRenameSheetProps {
  open: boolean;
  guideId: string;
  /** The current title. */
  title: string;
  renamer: RenameGuide;
  onClose: () => void;
}

/**
 * The sheet.
 * @param props - See `GuideRenameSheetProps`.
 * @returns The sheet.
 */
export function GuideRenameSheet({ open, guideId, title, renamer, onClose }: GuideRenameSheetProps) {
  return (
    <RenameSheet
      open={open}
      heading={GUIDE_COPY.renameTitle}
      label={GUIDE_COPY.titleField}
      saveLabel={GUIDE_COPY.save}
      title={title}
      problemOf={guideTitleProblem}
      isSaving={renamer.isSaving}
      onSave={(next) => renamer.rename(guideId, next)}
      onClose={onClose}
    />
  );
}
