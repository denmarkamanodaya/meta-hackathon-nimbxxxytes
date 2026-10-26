// The renderer's HTTP behaviour without IO: validate a render request, run one render at a
// time through injected ports, upload the file, answer with its duration and size.
import { z } from 'zod';
import { ShortPropsSchema, type ShortProps } from './composition/schema.ts';
import { totalFrames, type Quality } from './frames.ts';

/** `POST /render` body. */
export const RenderRequestSchema = z.object({
  props: ShortPropsSchema,
  quality: z.enum(['preview', 'final']),
  /** Presigned S3 PUT URL for the MP4. */
  out_url: z.url(),
});

/** What the service needs from the outside world. */
export interface RenderPorts {
  /** Renders the props to a local MP4 and resolves its path. */
  render: (props: ShortProps, quality: Quality) => Promise<string>;
  /** PUTs the file to the URL and resolves the bytes sent. */
  upload: (filePath: string, url: string) => Promise<number>;
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

/**
 * Builds the service.
 * @param ports - Render, upload and cleanup.
 * @returns `handle`, which answers one request; renders run one after another.
 */
export function createRenderService(ports: RenderPorts): {
  handle: (method: string, path: string, body: unknown) => Promise<HttpReply>;
} {
  let queue: Promise<unknown> = Promise.resolve();

  async function renderOnce(request: z.infer<typeof RenderRequestSchema>): Promise<HttpReply> {
    const { props, quality, out_url } = request;
    let filePath: string | null = null;
    try {
      filePath = await ports.render(props, quality);
      const bytes = await ports.upload(filePath, out_url);
      return { status: 200, body: { duration_s: totalFrames(props) / props.fps, bytes } };
    } catch (thrown) {
      return error(500, 'RENDER_FAILED', thrown instanceof Error ? thrown.message : 'Render failed');
    } finally {
      if (filePath !== null) await ports.remove(filePath);
    }
  }

  return {
    handle: (method, path, body) => {
      if (method === 'GET' && path === '/health') return Promise.resolve({ status: 200, body: { ok: true } });
      if (method !== 'POST' || path !== '/render') return Promise.resolve(error(404, 'NOT_FOUND', `${method} ${path}`));
      const parsed = RenderRequestSchema.safeParse(body);
      if (!parsed.success) {
        const issue = parsed.error.issues[0];
        const where = issue === undefined ? '' : `${issue.path.join('.')}: `;
        return Promise.resolve(error(400, 'VALIDATION_FAILED', `${where}${issue?.message ?? 'invalid body'}`));
      }
      const job = queue.then(() => renderOnce(parsed.data));
      queue = job.catch(() => undefined);
      return job;
    },
  };
}
