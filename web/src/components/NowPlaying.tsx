// The scene under the playhead: its description and facts (place, mood, objects).
import { Chip } from '../design/Chip';
import type { Segment } from '../services/api/types';
import './NowPlaying.css';

const MAX_OBJECTS = 3;

/** Props for `NowPlaying`. */
export interface NowPlayingProps {
  segment: Segment;
}

/**
 * Caption-like card for the playing scene; announced politely as it changes.
 * @param props - See `NowPlayingProps`.
 * @returns The card.
 */
export function NowPlaying({ segment }: NowPlayingProps) {
  const facts = [segment.place, segment.mood, ...segment.objects.slice(0, MAX_OBJECTS)].filter(
    (fact): fact is string => fact !== null && fact !== '',
  );
  return (
    <div className="now-playing" aria-live="polite">
      <p className="now-playing__text">{segment.description ?? 'Describing this scene…'}</p>
      {facts.length > 0 && (
        <div className="now-playing__facts">
          {facts.map((fact) => (
            <Chip key={fact}>{fact}</Chip>
          ))}
        </div>
      )}
    </div>
  );
}
