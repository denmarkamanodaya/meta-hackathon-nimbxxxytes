// The Mac guide page header's ⋯ (the Delete production pattern, V10a/V10b): "Delete guide…" opens
// the red confirm; deleting opens the Guides list in place of the guide.
import { useState } from 'react';
import { GUIDE_DELETE_COPY } from '../../core/delete-copy';
import { Icon } from '../../design/Icon';
import { Menu } from '../../design/Menu';
import { useDeleteGuide } from '../../hooks/useGuides';
import { useMenu } from '../../hooks/useMenu';
import { MacConfirmDialog } from './MacConfirmDialog';

/** The ⋯ button's and the menu's name. */
const OPTIONS_LABEL = 'Guide options';

/**
 * The ⋯ button, its menu and the confirm.
 * @param props - The guide.
 * @returns The controls.
 */
export function MacGuideOptions({ guideId }: { guideId: string }) {
  const menu = useMenu();
  const [isAsking, setAsking] = useState(false);
  const { remove, isDeleting } = useDeleteGuide();
  return (
    <>
      <button
        type="button"
        className="mac-button mac-button--head mac-button--icon"
        aria-label={`${OPTIONS_LABEL}: Delete guide`}
        aria-haspopup="menu"
        aria-expanded={menu.anchor !== null}
        onClick={menu.openFromButton}
      >
        <Icon name="more" size="xs" />
      </button>
      <Menu
        anchor={menu.anchor}
        label={OPTIONS_LABEL}
        onClose={menu.close}
        className="mac-menu--narrow"
        items={[
          {
            kind: 'item',
            label: `${GUIDE_DELETE_COPY.confirmLabel}…`,
            isDanger: true,
            onSelect: () => {
              setAsking(true);
            },
          },
        ]}
      />
      <MacConfirmDialog
        open={isAsking}
        copy={GUIDE_DELETE_COPY}
        isBusy={isDeleting}
        onCancel={() => {
          setAsking(false);
        }}
        onConfirm={() => {
          void remove(guideId);
        }}
      />
    </>
  );
}
