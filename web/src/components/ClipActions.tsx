// The clip page's ⋯ button on the player (mock V4) and its menu: "Make a short from this clip",
// then "Delete clip…" behind the confirm sheet (mock V3). A deleted clip leaves for the Library,
// replacing this page in history.
import { useState } from 'react';
import { useNavigate } from 'react-router';
import { Menu } from '../design/Menu';
import { MoreButton } from '../design/MoreButton';
import { useMenu } from '../hooks/useMenu';
import { ClipDeleteSheet, type DeleteTarget } from './ClipDeleteSheet';

/** Props for `ClipActions`. */
export interface ClipActionsProps {
  clipId: string;
  title: string;
  /** Opens the editor with every moment; null when the clip has none yet. */
  onMakeShort: (() => void) | null;
}

/**
 * The button, its menu and the delete sheet.
 * @param props - See `ClipActionsProps`.
 * @returns The controls.
 */
export function ClipActions({ clipId, title, onMakeShort }: ClipActionsProps) {
  const navigate = useNavigate();
  const menu = useMenu();
  const [targets, setTargets] = useState<DeleteTarget[]>([]);
  return (
    <>
      <MoreButton tone="overlay" isOpen={menu.anchor !== null} onClick={menu.openFromButton} />
      <Menu
        anchor={menu.anchor}
        label="Clip actions"
        onClose={menu.close}
        items={[
          { kind: 'item', label: 'Make a short from this clip', onSelect: () => onMakeShort?.(), isDisabled: onMakeShort === null },
          { kind: 'separator' },
          {
            kind: 'item',
            label: 'Delete clip…',
            isDanger: true,
            onSelect: () => {
              setTargets([{ clipId, title }]);
            },
          },
        ]}
      />
      <ClipDeleteSheet
        targets={targets}
        onCancel={() => {
          setTargets([]);
        }}
        onDone={(outcome) => {
          setTargets([]);
          if (outcome.deleted.includes(clipId)) void navigate('/', { replace: true });
        }}
      />
    </>
  );
}
