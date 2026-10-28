// The real render ports: renderMedia and renderStill on the bundled compositions, and the S3
// upload. Only server.ts constructs these.
import { randomUUID } from 'node:crypto';
import { readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { renderMedia, renderStill, selectComposition } from '@remotion/renderer';
import type { CoverStillProps } from './composition/cover.ts';
import type { CutoutProps } from './composition/cutout.ts';
import { COMPOSITION_ID, COVER_STILL_ID, CUTOUT_ID } from './composition/id.ts';
import type { ShortProps } from './composition/schema.ts';
import { frameAspect, outputSize, type Quality } from './frames.ts';
import type { RenderPorts } from './render-service.ts';

/** Encoder settings per quality: previews are fast and small, finals are for posting. */
export const ENCODING: Record<Quality, { crf: number; x264Preset: 'veryfast' | 'medium' }> = {
  preview: { crf: 28, x264Preset: 'veryfast' },
  final: { crf: 18, x264Preset: 'medium' },
};

/** Settings for the render port. */
export interface RemotionRenderOptions {
  /** Bundle URL from `@remotion/bundler`'s `bundle()`. */
  serveUrl: string;
  /** Directory for temporary MP4s. */
  outDir: string;
  /** Per-render timeout, ms. */
  timeoutMs: number;
  /** Browser tabs rendering frames in parallel; sets CPU and memory use per render. */
  concurrency: number;
  /** Cap on Remotion's decoded-video-frame cache, bytes; the main memory cost of a final. */
  videoCacheBytes: number;
}

/**
 * Builds `render`: select the composition with the props, render h264 at the quality's scale.
 * @param options - Bundle, temp dir and timeout.
 * @returns The render port function.
 */
export function createRemotionRender(options: RemotionRenderOptions): RenderPorts['render'] {
  return async (props: ShortProps, quality: Quality) => {
    const inputProps: Record<string, unknown> = props;
    const composition = await selectComposition({ serveUrl: options.serveUrl, id: COMPOSITION_ID, inputProps });
    const outputLocation = join(options.outDir, `${randomUUID()}.mp4`);
    // Render at the output size; the composition scales its 1080-wide stage to fit.
    await renderMedia({
      composition: { ...composition, ...outputSize(frameAspect(props), quality) },
      serveUrl: options.serveUrl,
      codec: 'h264',
      inputProps,
      outputLocation,
      timeoutInMilliseconds: options.timeoutMs,
      concurrency: options.concurrency,
      offthreadVideoCacheSizeInBytes: options.videoCacheBytes,
      ...ENCODING[quality],
    });
    return outputLocation;
  };
}

/** JPEG quality of a cover still, 0–100. */
export const STILL_JPEG_QUALITY = 90;

/** Settings for the still port. */
export interface RemotionStillOptions {
  /** Bundle URL from `@remotion/bundler`'s `bundle()`. */
  serveUrl: string;
  /** Directory for temporary JPEGs and PNGs. */
  outDir: string;
  /** Per-still timeout, ms. */
  timeoutMs: number;
}

/** How a still is encoded: a JPEG cover, or a PNG with the page background left transparent. */
type StillEncoding = { imageFormat: 'jpeg'; jpegQuality: number; extension: 'jpg' } | { imageFormat: 'png'; extension: 'png' };

/** Selects a still composition with the props and draws it to a local file; resolves its path. */
async function drawStill(
  options: RemotionStillOptions,
  id: string,
  inputProps: Record<string, unknown>,
  { extension, ...encoding }: StillEncoding,
): Promise<string> {
  const composition = await selectComposition({ serveUrl: options.serveUrl, id, inputProps });
  const output = join(options.outDir, `${randomUUID()}.${extension}`);
  await renderStill({
    composition,
    serveUrl: options.serveUrl,
    inputProps,
    output,
    ...encoding,
    timeoutInMilliseconds: options.timeoutMs,
  });
  return output;
}

/**
 * Builds `still`: select CoverStill with the props (its size comes from them), draw one JPEG.
 * @param options - Bundle, temp dir and timeout.
 * @returns The still port function.
 */
export function createRemotionStill(options: RemotionStillOptions): RenderPorts['still'] {
  return (props: CoverStillProps) =>
    drawStill(options, COVER_STILL_ID, props, { imageFormat: 'jpeg', jpegQuality: STILL_JPEG_QUALITY, extension: 'jpg' });
}

/**
 * Builds `cutout`: select Cutout with the props (its size comes from the box), draw one PNG.
 * Remotion 4.0.538 has no separate transparency option: a `png` still is captured with the page
 * background omitted, so whatever the composition leaves unpainted is transparent.
 * @param options - Bundle, temp dir and timeout.
 * @returns The cutout port function.
 */
export function createRemotionCutout(options: RemotionStillOptions): RenderPorts['cutout'] {
  return (props: CutoutProps) => drawStill(options, CUTOUT_ID, props, { imageFormat: 'png', extension: 'png' });
}

/**
 * PUTs a file to a presigned URL.
 * @param fetchFn - Fetch implementation; tests inject a fake.
 * @returns The upload port function; rejects on a non-2xx answer.
 */
export function createUpload(fetchFn: typeof fetch = fetch): RenderPorts['upload'] {
  return async (filePath, url, contentType) => {
    const bytes = await readFile(filePath);
    const response = await fetchFn(url, { method: 'PUT', body: bytes, headers: { 'Content-Type': contentType } });
    if (!response.ok) throw new Error(`Upload answered ${String(response.status)}`);
    return bytes.byteLength;
  };
}

/** Deletes a temp file, ignoring a file that is already gone. */
export const removeFile: RenderPorts['remove'] = async (filePath) => {
  await rm(filePath, { force: true });
};
