// The 176×220 preview on the Make-a-short screen: the Remotion Player when the draft has
// composition props (edits show at once), else the server's preview MP4, with a mono
// "vN · m:ss" badge.
import type { PlayerRef } from '@remotion/player';
import { useRef } from 'react';
import type { ShortProps } from '@nimbytes/composition';
import { previewBadge } from '../core/studio';
import { Spinner } from '../design/Spinner';
import type { ShortVersion } from '../services/api/types';
import { ShortPlayer } from './ShortPlayer';
import './ShortPreview.css';

/** Props for `ShortPreview`. */
export interface ShortPreviewProps {
  version: ShortVersion | null;
  playerProps: ShortProps | null;
  /** Length shown on the badge, seconds. */
  lengthS: number | null;
  /** The short is still being made (a spinner instead of "No preview"). */
  isWorking: boolean;
  /** Extra badge part after the length, such as "from disk" in the Mac app. */
  badgeSuffix?: string;
}

/**
 * The preview tile.
 * @param props - See `ShortPreviewProps`.
 * @returns The tile.
 */
export function ShortPreview({ version, playerProps, lengthS, isWorking, badgeSuffix }: ShortPreviewProps) {
  const playerRef = useRef<PlayerRef>(null);
  const badge = version === null ? null : previewBadge(version.n, lengthS, badgeSuffix);
  return (
    <div className="short-preview">
      {playerProps !== null ? (
        <ShortPlayer props={playerProps} playerRef={playerRef} />
      ) : version !== null && version.preview_url !== null ? (
        <video className="short-preview__video" src={version.preview_url} controls playsInline preload="metadata" />
      ) : (
        <div className="short-preview__pending" role="status">
          {isWorking ? (
            <>
              <Spinner />
              Making the first cut…
            </>
          ) : (
            'No preview for this draft'
          )}
        </div>
      )}
      {badge !== null && <span className="short-preview__badge">{badge}</span>}
    </div>
  );
}
