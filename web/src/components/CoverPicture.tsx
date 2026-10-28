// A cover as it will be posted: the drawn picture with the short title laid over it in CSS. The
// published still is baked on the server; this overlay is the live preview while the title is
// typed and while the still bakes. It fills its box; the strip, the large preview and the PWA
// tiles size it.
import type { ReactNode } from 'react';
import type { CoverTitlePosition } from '../services/api/types';
import './CoverPicture.css';

/** Props for `CoverPicture`. */
export interface CoverPictureProps {
  url: string;
  alt: string;
  /** The title to lay over it, or null for none. */
  overlay: { text: string; position: CoverTitlePosition } | null;
  /** `strip` for tiles, `large` for the right column's preview (a bigger title). */
  size: 'strip' | 'large';
  /** Badges and states drawn over the picture (the pick tick, the drawing veil). */
  children?: ReactNode;
}

/**
 * The picture and its title.
 * @param props - See `CoverPictureProps`.
 * @returns The cover.
 */
export function CoverPicture({ url, alt, overlay, size, children }: CoverPictureProps) {
  return (
    <span className={`cover-picture cover-picture--${size}`}>
      <img className="cover-picture__img" src={url} alt={alt} loading="lazy" />
      {overlay !== null && (
        <span className={`cover-picture__title cover-picture__title--${overlay.position}`} aria-hidden="true">
          {overlay.text}
        </span>
      )}
      {children}
    </span>
  );
}
