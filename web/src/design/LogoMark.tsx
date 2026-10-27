// The nimbytes mark in the app, drawn in the design tokens. Its geometry has one home, the
// composition's LogoMark, which the rendered end card also draws.
import { LogoMark as Mark } from '@nimbytes/logo';

/** Props for `LogoMark`. */
export interface LogoMarkProps {
  /** Width and height, px. */
  size: number;
  className?: string;
}

/**
 * The mark; decorative, so put the name next to it.
 * @param props - See `LogoMarkProps`.
 * @returns The SVG.
 */
export function LogoMark({ size, className }: LogoMarkProps) {
  return (
    <Mark
      size={size}
      tile="var(--accent)"
      cloud="var(--color-surface)"
      bytes="var(--accent)"
      {...(className === undefined ? {} : { className })}
    />
  );
}
