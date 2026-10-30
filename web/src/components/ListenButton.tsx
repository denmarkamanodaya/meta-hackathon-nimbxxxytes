// "Listen" on a clip (iListen): starts a listen of the clip in the remembered output language and
// opens it, where the stages show while it works. The PWA clip page and the Mac clip panel draw it
// in their own look, next to "Make a guide".
import { ILISTEN_COPY } from '../core/ilisten/listens';
import { Icon } from '../design/Icon';
import { useListenToClip } from '../hooks/useListens';

/**
 * The button.
 * @param props - The clip and the app's button class.
 * @returns The button.
 */
export function ListenButton({ clipId, className }: { clipId: string; className: string }) {
  const { start, isStarting } = useListenToClip();
  return (
    <button
      type="button"
      className={className}
      disabled={isStarting}
      onClick={() => {
        start(clipId);
      }}
    >
      <Icon name="wave" size="sm" />
      {isStarting ? ILISTEN_COPY.starting : ILISTEN_COPY.listen}
    </button>
  );
}
