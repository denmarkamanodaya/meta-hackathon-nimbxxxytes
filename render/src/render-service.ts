// The renderer's HTTP behaviour without IO: validate a render or still request, run one job at a
// time through injected ports, upload the file, answer with its size (and a render's duration).
import { z } from 'zod';
import { CoverStillPropsSchema, type CoverStillProps } from './composition/cover.ts';
import { ShortPropsSchema, type ShortProps } from './composition/schema.ts';
import { totalFrames, type Quality } from './frames.ts';

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

/** What the service needs from the outside world. */
export interface RenderPorts {
  /** Renders the props to a local MP4 and resolves its path. */
  render: (props: ShortProps, quality: Quality) => Promise<string>;
  /** Draws the titled cover to a local JPEG and resolves its path. */
  still: (props: CoverStillProps) => Promise<string>;
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
      if (method === 'POST' && path === '/still') {
        const parsed = parse(StillRequestSchema, body);
        return parsed.ok ? enqueue(() => stillOnce(parsed.value)) : Promise.resolve(parsed.reply);
      }
      return Promise.resolve(error(404, 'NOT_FOUND', `${method} ${path}`));
    },
  };
}
