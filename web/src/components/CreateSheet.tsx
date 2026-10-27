// The "+" sheet (N2): what you can make from anywhere. Upload clips, or start a new short.
import { Link } from 'react-router';
import { STUDIO_COPY } from '../core/copy';
import { Icon, type IconName } from '../design/Icon';
import { Sheet } from '../design/Sheet';
import './CreateSheet.css';

/** Props for `CreateSheet`. */
export interface CreateSheetProps {
  open: boolean;
  onClose: () => void;
}

const ITEMS: readonly { to: string; icon: IconName; title: string; line: string }[] = [
  { to: '/upload', icon: 'plus', title: 'Upload clips', line: 'From your phone to your private cloud.' },
  { to: '/editor', icon: 'sparkle', title: STUDIO_COPY.newShort, line: 'Pick moments; the editor cuts, captions and checks a draft.' },
];

/**
 * The sheet.
 * @param props - See `CreateSheetProps`.
 * @returns The sheet.
 */
export function CreateSheet({ open, onClose }: CreateSheetProps) {
  return (
    <Sheet open={open} onClose={onClose} title="Create">
      <ul className="create-sheet">
        {ITEMS.map((item) => (
          <li key={item.to}>
            <Link className="create-sheet__item" to={item.to} onClick={onClose}>
              <span className="create-sheet__icon" aria-hidden="true">
                <Icon name={item.icon} size="md" />
              </span>
              <span className="create-sheet__text">
                <span className="create-sheet__title">{item.title}</span>
                <span className="create-sheet__line">{item.line}</span>
              </span>
              <Icon name="forward" size="sm" />
            </Link>
          </li>
        ))}
      </ul>
    </Sheet>
  );
}
