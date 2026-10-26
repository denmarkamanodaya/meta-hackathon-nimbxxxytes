import { describe, expect, it, vi } from 'vitest';
import { ApiError } from '../api/client';
import { createXhrPutPart } from './put-part';

interface Sent {
  method: string;
  url: string;
  body: unknown;
  headers: Record<string, string>;
}

/** The parts of the XHR double a test drives to settle a request. */
interface XhrHandle {
  status: number;
  responseHeaders: Record<string, string>;
  upload: { onprogress: ((event: { loaded: number }) => void) | null };
  onload: (() => void) | null;
  onerror: (() => void) | null;
}

/** Minimal XMLHttpRequest double: records the request and lets the test settle it. */
function fakeXhr(respond: (xhr: XhrHandle) => void) {
  const sent: Sent[] = [];
  class FakeXhr {
    status = 0;
    timeout = 0;
    responseHeaders: Record<string, string> = {};
    upload: { onprogress: ((event: { loaded: number }) => void) | null } = { onprogress: null };
    onload: (() => void) | null = null;
    onerror: (() => void) | null = null;
    ontimeout: (() => void) | null = null;
    onabort: (() => void) | null = null;
    private request: Sent = { method: '', url: '', body: null, headers: {} };
    open(method: string, url: string) {
      this.request = { ...this.request, method, url };
    }
    setRequestHeader(name: string, value: string) {
      this.request.headers[name] = value;
    }
    getResponseHeader(name: string) {
      return this.responseHeaders[name] ?? null;
    }
    send(body: unknown) {
      sent.push({ ...this.request, body });
      respond(this);
    }
    abort() {
      this.onabort?.();
    }
  }
  return { Xhr: FakeXhr as unknown as typeof XMLHttpRequest, sent };
}

describe('createXhrPutPart', () => {
  it('PUTs the raw part to the presigned URL with no added headers and resolves the ETag', async () => {
    const { Xhr, sent } = fakeXhr((xhr) => {
      xhr.status = 200;
      xhr.responseHeaders.ETag = '"9b2cf535f27731c974343645a3985328"';
      xhr.onload?.();
    });
    const body = new Blob(['abc']);
    const putPart = createXhrPutPart(60_000, Xhr);

    const etag = await putPart('https://s3.example/k?partNumber=2', body, vi.fn(), new AbortController().signal);

    expect(etag).toBe('"9b2cf535f27731c974343645a3985328"');
    expect(sent).toEqual([
      { method: 'PUT', url: 'https://s3.example/k?partNumber=2', body, headers: {} },
    ]);
  });

  it('reports upload progress in bytes', async () => {
    const onProgress = vi.fn();
    const { Xhr } = fakeXhr((xhr) => {
      xhr.upload.onprogress?.({ loaded: 1024 });
      xhr.status = 200;
      xhr.responseHeaders.ETag = '"e"';
      xhr.onload?.();
    });

    await createXhrPutPart(60_000, Xhr)('u', new Blob([]), onProgress, new AbortController().signal);

    expect(onProgress).toHaveBeenCalledWith(1024);
  });

  it('rejects with ETAG_MISSING when CORS hides the ETag header', async () => {
    const { Xhr } = fakeXhr((xhr) => {
      xhr.status = 200;
      xhr.onload?.();
    });

    const result = createXhrPutPart(60_000, Xhr)('u', new Blob([]), vi.fn(), new AbortController().signal);

    await expect(result).rejects.toMatchObject({ code: 'ETAG_MISSING' });
  });

  it('rejects with PART_FAILED and the S3 status on a non-2xx answer', async () => {
    const { Xhr } = fakeXhr((xhr) => {
      xhr.status = 403;
      xhr.onload?.();
    });

    const result = createXhrPutPart(60_000, Xhr)('u', new Blob([]), vi.fn(), new AbortController().signal);

    await expect(result).rejects.toMatchObject({ code: 'PART_FAILED', status: 403 });
  });

  it('rejects with NETWORK_ERROR when the connection drops', async () => {
    const { Xhr } = fakeXhr((xhr) => {
      xhr.onerror?.();
    });

    const result = createXhrPutPart(60_000, Xhr)('u', new Blob([]), vi.fn(), new AbortController().signal);

    await expect(result).rejects.toBeInstanceOf(ApiError);
    await expect(result).rejects.toMatchObject({ code: 'NETWORK_ERROR' });
  });

  it('rejects with AbortError when the signal is already aborted, without sending', async () => {
    const { Xhr, sent } = fakeXhr(() => undefined);
    const controller = new AbortController();
    controller.abort();

    const result = createXhrPutPart(60_000, Xhr)('u', new Blob([]), vi.fn(), controller.signal);

    await expect(result).rejects.toMatchObject({ name: 'AbortError' });
    expect(sent).toEqual([]);
  });
});
