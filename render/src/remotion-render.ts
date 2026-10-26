// The real render port: renderMedia on the bundled composition, and the S3 upload. Only
// server.ts constructs these.
import { randomUUID } from 'node:crypto';
import { readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { renderMedia, selectComposition } from '@remotion/renderer';
import { COMPOSITION_ID } from './composition/id.ts';
import type { ShortProps } from './composition/schema.ts';
import { outputSize, type Quality } from './frames.ts';
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
      composition: { ...composition, ...outputSize(props.aspect, quality) },
      serveUrl: options.serveUrl,
      codec: 'h264',
      inputProps,
      outputLocation,
      timeoutInMilliseconds: options.timeoutMs,
      ...ENCODING[quality],
    });
    return outputLocation;
  };
}

/**
 * PUTs a file to a presigned URL.
 * @param fetchFn - Fetch implementation; tests inject a fake.
 * @returns The upload port function; rejects on a non-2xx answer.
 */
export function createUpload(fetchFn: typeof fetch = fetch): RenderPorts['upload'] {
  return async (filePath, url) => {
    const bytes = await readFile(filePath);
    const response = await fetchFn(url, { method: 'PUT', body: bytes, headers: { 'Content-Type': 'video/mp4' } });
    if (!response.ok) throw new Error(`Upload answered ${String(response.status)}`);
    return bytes.byteLength;
  };
}

/** Deletes a temp file, ignoring a file that is already gone. */
export const removeFile: RenderPorts['remove'] = async (filePath) => {
  await rm(filePath, { force: true });
};
