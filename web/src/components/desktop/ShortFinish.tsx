// "Finish on your Mac" in the Mac Short page's right column (redesign v2, V7): open the cut as an
// FCPXML timeline in Final Cut Pro, show the FCPXML in Finder for Resolve and Premiere, or show
// the render in Finder once there is one.
import type { ReactNode } from 'react';
import { Icon, type IconName } from '../../design/Icon';
import { Spinner } from '../../design/Spinner';
import { useIsMacApp, useNleActions } from '../../hooks/useDesktop';
import './MacColumns.css';
import './ShortFinish.css';

/** What the FCPXML leaves out; the Open button's tooltip. */
const NOT_EXPORTED = 'Captions, punch-in and transitions are not exported.';

function Row({ icon, onClick, isDisabled = false, title, children }: { icon: IconName; onClick: () => void; isDisabled?: boolean; title?: string; children: ReactNode }) {
  return (
    <button type="button" className="mac-button short-finish__row" disabled={isDisabled} title={title} onClick={onClick}>
      <Icon name={icon} size="xs" />
      <span className="short-finish__label">{children}</span>
    </button>
  );
}

/**
 * The section.
 * @param props - The short and whether its final render exists.
 * @returns The section.
 */
export function ShortFinish({ shortId, hasRender }: { shortId: string; hasRender: boolean }) {
  const { openInFinalCut, revealFcpxml, revealRender, isOpening, isFinderFallback } = useNleActions(shortId);
  if (!useIsMacApp()) return null; // Final Cut and Finder are on the Mac only.
  return (
    <section className="short-finish" aria-label="Finish on your Mac">
      <span className="mac-columns__label">Finish on your Mac</span>
      <p className="short-finish__note">
        Opens the cut as an editable timeline, media linked from ~/nimbytes. Captions, punch-in and transitions stay in nimbytes.
      </p>
      <Row
        icon="timeline"
        title={NOT_EXPORTED}
        isDisabled={isOpening}
        onClick={() => {
          void openInFinalCut();
        }}
      >
        {isOpening && <Spinner />}
        Open in Final Cut Pro
      </Row>
      <Row icon="reveal" onClick={revealFcpxml}>
        Show FCPXML <span className="short-finish__muted">(Resolve, Premiere)</span>
      </Row>
      <Row icon="reveal" isDisabled={!hasRender} onClick={revealRender}>
        Show render in Finder
      </Row>
      {isFinderFallback && (
        <span className="short-finish__note" role="status">
          Final Cut Pro isn’t installed, so this opens the folder. In DaVinci Resolve: File › Import › Timeline.
        </span>
      )}
    </section>
  );
}
