// Skeleton primitive: a soft placeholder block shown while content loads.
import './Skeleton.css';

/** Shapes the screens need. */
export type SkeletonKind = 'thumb' | 'video' | 'line' | 'line-short' | 'title' | 'avatar';

/** Props for `Skeleton`. */
export interface SkeletonProps {
  kind: SkeletonKind;
}

/**
 * Decorative placeholder; the surrounding region carries `aria-busy` and a status text.
 * @param props - See `SkeletonProps`.
 * @returns The block.
 */
export function Skeleton({ kind }: SkeletonProps) {
  return <span className={`skeleton skeleton--${kind}`} aria-hidden="true" />;
}
