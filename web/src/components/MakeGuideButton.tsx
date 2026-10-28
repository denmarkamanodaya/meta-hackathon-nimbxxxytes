// "Make a guide" on a clip (MyWay): starts the guide from the clip and opens it, where the stages
// show while it is made. The PWA clip page and the Mac clip panel draw it in their own look.
import { GUIDE_COPY } from '../core/guides';
import { Icon } from '../design/Icon';
import { useStartGuide } from '../hooks/useGuides';

/** Props for `MakeGuideButton`. */
export interface MakeGuideButtonProps {
  clipId: string;
  /** The app's button class. */
  className: string;
  /** The label ("Make a guide"). */
  label: string;
}

/**
 * The button.
 * @param props - See `MakeGuideButtonProps`.
 * @returns The button.
 */
export function MakeGuideButton({ clipId, className, label }: MakeGuideButtonProps) {
  const { start, isStarting } = useStartGuide();
  return (
    <button
      type="button"
      className={className}
      disabled={isStarting}
      onClick={() => {
        start(clipId);
      }}
    >
      <Icon name="guides" size="sm" />
      {isStarting ? GUIDE_COPY.starting : label}
    </button>
  );
}
