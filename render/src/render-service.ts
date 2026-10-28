// The renderer's HTTP behaviour without IO: validate a render, still (a cover, or a guide step
// when the body names `composition: "StepStill"`), cut-out or mask request,
// run one job at a time through injected ports, upload the file, answer with its size (and a
// render's duration). A mask outline is answered at once, outside the queue.
import { z } from 'zod';
import { CoverStillPropsSchema, type CoverStillProps } from './composition/cover.ts';
import { BoxSchema, FrameSizeSchema, type CutoutProps } from './composition/cutout.ts';
import { ShortPropsSchema, type ShortProps } from './composition/schema.ts';
import { totalFrames, type Quality } from './frames.ts';
import { StepStillPropsSchema, type StepStillProps } from './composition/step.ts';
import { MaskSchema, maskToFramePath } from './mask.ts';

/** `POST /render` body. */
export const RenderRequestSchema = z.object({
  props: ShortPropsSchema,
  quality: z.enum(['preview', 'final']),
  /** Presigned S3 PUT URL for the MP4. */
  out_url: z.url(),
});

/** `POST /still` body. */
export const StillRequestSchema = z.object({
  props: CoverStillPropsSchema,
  /** Presigned S3 PUT URL for the JPEG. */
  out_url: z.url(),
});

/** `POST /still` body of a guide step: the composition named, so a cover body needs no change. */
export const StepStillRequestSchema = z.object({
  composition: z.literal('StepStill'),
  props: StepStillPropsSchema,
  /** Presigned PUT URL for the JPEG. */
  out_url: z.url(),
});

/** Whether a `/still` body asks for a guide step still. */
function isStepStill(body: unknown): boolean {
  return typeof body === 'object' && body !== null && (body as { composition?: unknown }).composition === 'StepStill';
}

/** `POST /mask/path` body: a SAM mask and its record's box. */
export const MaskPathRequestSchema = z.object({ mask: MaskSchema, box: BoxSchema });

/** `POST /cutout` body: the frame picture, a SAM mask on it, and where the PNG goes. */
export const CutoutRequestSchema = z
  .object({
    /** Presigned URL of the frame picture the mask was made on. */
    image_url: z.string().min(1),
    frame: FrameSizeSchema,
    mask: MaskSchema,
    box: BoxSchema,
    /** Sticker look: padding and a white outline. */
    sticker: z.boolean(),
    /** Presigned PUT URL for the PNG. */
    out_url: z.url(),
  })
  .refine((body) => body.box.x2 < body.frame.w && body.box.y2 < body.frame.h, {
    message: 'box must lie inside the frame',
    path: ['box'],
  });

/** What the service needs from the outside world. */
export interface RenderPorts {
  /** Renders the props to a local MP4 and resolves its path. */
  render: (props: ShortProps, quality: Quality) => Promise<string>;
  /** Draws the titled cover to a local JPEG and resolves its path. */
  still: (props: CoverStillProps) => Promise<string>;
  /** Draws a guide step still to a local JPEG and resolves its path. */
  stepStill: (props: StepStillProps) => Promise<string>;
  /** Draws the cut-out to a local transparent PNG and resolves its path. */
  cutout: (props: CutoutProps) => Promise<string>;
  /** PUTs the file to the URL with the content type and resolves the bytes sent. */
  upload: (filePath: string, url: string, contentType: string) => Promise<number>;
  /** Deletes the local file. Never rejects. */
  remove: (filePath: string) => Promise<void>;
}

/** An HTTP answer: status and JSON body. */
export interface HttpReply {
  status: number;
  body: unknown;
}

const error = (status: number, code: string, message: string): HttpReply => ({
  status,
  body: { error: { code, message } },
});

/** Answers 400 with the first schema issue, or hands the parsed body on. */
function parse<T>(schema: z.ZodType<T>, body: unknown): { ok: true; value: T } | { ok: false; reply: HttpReply } {
  const parsed = schema.safeParse(body);
  if (parsed.success) return { ok: true, value: parsed.data };
  const issue = parsed.error.issues[0];
  const where = issue === undefined ? '' : `${issue.path.join('.')}: `;
  return { ok: false, reply: error(400, 'VALIDATION_FAILED', `${where}${issue?.message ?? 'invalid body'}`) };
}

/**
 * Builds the service.
 * @param ports - Render, still, upload and cleanup.
 * @returns `handle`, which answers one request; renders and stills run one after another.
 */
export function createRenderService(ports: RenderPorts): {
  handle: (method: string, path: string, body: unknown) => Promise<HttpReply>;
} {
  let queue: Promise<unknown> = Promise.resolve();

  /** Makes a local file, uploads it, always removes it; resolves the bytes sent. */
  async function produce(make: () => Promise<string>, url: string, contentType: string): Promise<number> {
    let filePath: string | null = null;
    try {
      filePath = await make();
      return await ports.upload(filePath, url, contentType);
    } finally {
      if (filePath !== null) await ports.remove(filePath);
    }
  }

  /** Runs a job, turning any failure into a 500 RENDER_FAILED. */
  async function failsAs500(run: () => Promise<HttpReply>): Promise<HttpReply> {
    try {
      return await run();
    } catch (thrown) {
      return error(500, 'RENDER_FAILED', thrown instanceof Error ? thrown.message : 'Render failed');
    }
  }

  const renderOnce = ({ props, quality, out_url }: z.infer<typeof RenderRequestSchema>) =>
    failsAs500(async () => {
      const bytes = await produce(() => ports.render(props, quality), out_url, 'video/mp4');
      return { status: 200, body: { duration_s: totalFrames(props) / props.fps, bytes } };
    });

  const stillOnce = ({ props, out_url }: z.infer<typeof StillRequestSchema>) =>
    failsAs500(async () => {
      const size = await produce(() => ports.still(props), out_url, 'image/jpeg');
      return { status: 200, body: { size } };
    });

  const stepStillOnce = ({ props, out_url }: z.infer<typeof StepStillRequestSchema>) =>
    failsAs500(async () => {
      const size = await produce(() => ports.stepStill(props), out_url, 'image/jpeg');
      return { status: 200, body: { size } };
    });

  const cutoutOnce = (props: CutoutProps, outUrl: string) =>
    failsAs500(async () => {
      const size = await produce(() => ports.cutout(props), outUrl, 'image/png');
      return { status: 200, body: { size } };
    });

  /** Queues a job behind every earlier one (renders and stills share the one queue). */
  function enqueue(job: () => Promise<HttpReply>): Promise<HttpReply> {
    const run = queue.then(job);
    queue = run.catch(() => undefined);
    return run;
  }

  return {
    handle: (method, path, body) => {
      if (method === 'GET' && path === '/health') return Promise.resolve({ status: 200, body: { ok: true } });
      if (method === 'POST' && path === '/render') {
        const parsed = parse(RenderRequestSchema, body);
        return parsed.ok ? enqueue(() => renderOnce(parsed.value)) : Promise.resolve(parsed.reply);
      }
      if (method === 'POST' && path === '/still' && isStepStill(body)) {
        const parsed = parse(StepStillRequestSchema, body);
        return parsed.ok ? enqueue(() => stepStillOnce(parsed.value)) : Promise.resolve(parsed.reply);
      }
      if (method === 'POST' && path === '/still') {
        const parsed = parse(StillRequestSchema, body);
        return parsed.ok ? enqueue(() => stillOnce(parsed.value)) : Promise.resolve(parsed.reply);
      }
      if (method === 'POST' && path === '/mask/path') {
        // Decoding is quick and needs no browser, so it answers at once instead of queueing.
        const parsed = parse(MaskPathRequestSchema, body);
        if (!parsed.ok) return Promise.resolve(parsed.reply);
        const outline = maskToFramePath(parsed.value.mask, parsed.value.box);
        return Promise.resolve(
          outline.ok ? { status: 200, body: { path: outline.path } } : error(400, 'VALIDATION_FAILED', `mask: ${outline.message}`),
        );
      }
      if (method === 'POST' && path === '/cutout') {
        const parsed = parse(CutoutRequestSchema, body);
        if (!parsed.ok) return Promise.resolve(parsed.reply);
        const { image_url, frame, mask, box, sticker, out_url } = parsed.value;
        const outline = maskToFramePath(mask, box);
        if (!outline.ok) return Promise.resolve(error(400, 'VALIDATION_FAILED', `mask: ${outline.message}`));
        return enqueue(() => cutoutOnce({ image_url, frame, path: outline.path, box, sticker }, out_url));
      }
      return Promise.resolve(error(404, 'NOT_FOUND', `${method} ${path}`));
    },
  };
}
