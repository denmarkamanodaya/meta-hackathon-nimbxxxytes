// Adding a letter: register it, then send the file itself through the API with the type the API
// was told (no storage PUT on any platform). A failure says why on the page and deletes the empty
// letter; Try again on a stuck upload adds the file afresh. Asking about it keeps the answer. A
// file the API cannot read never leaves the device.
import { act, useEffect } from 'react';
import { MemoryRouter } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { describeError } from '../core/error-text';
import { ApiError, type ApiClient } from '../services/api/client';
import { fakeApi, fakeServices, mount, type Mounted } from '../test-support/services';
import { useAddDocument, useAskDocument, useRetryUpload, type AddDocument, type AskDocument, type RetryUpload } from './useDocuments';

let view: Mounted | null = null;
afterEach(() => {
  view?.unmount();
  view = null;
});

const box: { add: AddDocument | null; ask: AskDocument | null; retry: RetryUpload | null } = { add: null, ask: null, retry: null };

function Probe() {
  const add = useAddDocument();
  const ask = useAskDocument('doc_water');
  const retry = useRetryUpload();
  useEffect(() => {
    box.add = add;
    box.ask = ask;
    box.retry = retry;
  });
  return null;
}

async function open(api: Partial<ApiClient>) {
  const putFile = vi.fn(() => Promise.resolve('"etag"'));
  const services = fakeServices({ api: fakeApi(api), putFile });
  view = await mount(
    <MemoryRouter>
      <Probe />
    </MemoryRouter>,
    services,
  );
  return { putFile, toasts: services.toasts };
}

const add = (file: File) => {
  if (box.add === null) throw new Error('no hook');
  return box.add.add(file);
};

const created = (id: string) => vi.fn<ApiClient['createDocument']>().mockResolvedValue({ document_id: id, upload_url: 'https://r2/put' });
const sentOk = (id: string) => vi.fn<ApiClient['sendDocumentSource']>().mockResolvedValue({ document_id: id, status: 'reading' });

describe('useAddDocument', () => {
  it('creates, sends the file itself through the API, and resolves the id; never a storage PUT', async () => {
    const createDocument = created('d1');
    const sendDocumentSource = sentOk('d1');
    const { putFile } = await open({ createDocument, sendDocumentSource });
    const file = new File(['jpeg'], 'bill.jpg', { type: 'image/jpeg' });

    let id: string | null = null;
    await act(async () => {
      id = await add(file);
    });

    expect(createDocument).toHaveBeenCalledWith({ filename: 'bill.jpg', content_type: 'image/jpeg', size_bytes: 4 });
    expect(sendDocumentSource).toHaveBeenCalledWith('d1', file);
    expect(putFile).not.toHaveBeenCalled();
    expect(id).toBe('d1');
    expect(box.add?.error).toBeNull();
  });

  it('sends a typeless PDF with the type read from its name, the type the API was told', async () => {
    const createDocument = created('d2');
    const sendDocumentSource = sentOk('d2');
    await open({ createDocument, sendDocumentSource });

    await act(async () => {
      await add(new File(['%PDF'], 'Rates.pdf', { type: '' }));
    });

    expect(createDocument.mock.calls[0]?.[0].content_type).toBe('application/pdf');
    expect(sendDocumentSource.mock.calls[0]?.[1].type).toBe('application/pdf');
  });

  it('keeps a file the API cannot read on the device and says why, on the page too', async () => {
    const createDocument = vi.fn<ApiClient['createDocument']>();
    const { toasts } = await open({ createDocument });

    let id: string | null = 'x';
    await act(async () => {
      id = await add(new File(['x'], 'clip.mov', { type: 'video/quicktime' }));
    });

    expect(id).toBeNull();
    expect(createDocument).not.toHaveBeenCalled();
    expect(toasts.getSnapshot()[0]?.title).toBe('This file cannot be read');
    expect(box.add?.error).toBe('nimbytes reads photos (JPEG, PNG, WebP) and PDFs.');
  });

  it('when the file does not get there: null, a toast, the error for the page, and the empty letter deleted', async () => {
    const deleteDocument = vi.fn<ApiClient['deleteDocument']>().mockResolvedValue(true);
    const sendDocumentSource = vi.fn<ApiClient['sendDocumentSource']>().mockRejectedValue(new ApiError('NETWORK_ERROR', 'lost', null));
    const { toasts } = await open({ createDocument: created('d3'), sendDocumentSource, deleteDocument });

    let id: string | null = 'x';
    await act(async () => {
      id = await add(new File(['x'], 'a.png', { type: 'image/png' }));
    });

    expect(id).toBeNull();
    expect(deleteDocument).toHaveBeenCalledWith('d3');
    expect(toasts.getSnapshot()[0]?.title).toBe('Could not add the letter');
    expect(box.add?.error).toBe(describeError(new ApiError('NETWORK_ERROR', 'lost', null)).text);
    expect(box.add?.isAdding).toBe(false);
  });

  it('when creating fails, nothing is deleted and the page still gets the error', async () => {
    const deleteDocument = vi.fn<ApiClient['deleteDocument']>();
    const createDocument = vi.fn<ApiClient['createDocument']>().mockRejectedValue(new ApiError('TIMEOUT', 'slow', null));
    await open({ createDocument, deleteDocument });

    await act(async () => {
      await add(new File(['x'], 'a.png', { type: 'image/png' }));
    });

    expect(deleteDocument).not.toHaveBeenCalled();
    expect(box.add?.error).not.toBeNull();
  });
});

describe('useRetryUpload', () => {
  it('adds the re-picked file afresh, then deletes the stuck letter', async () => {
    const deleteDocument = vi.fn<ApiClient['deleteDocument']>().mockResolvedValue(true);
    const sendDocumentSource = sentOk('d9');
    await open({ createDocument: created('d9'), sendDocumentSource, deleteDocument });
    const file = new File(['%PDF'], 'again.pdf', { type: 'application/pdf' });

    let id: string | null = null;
    await act(async () => {
      id = (await box.retry?.retry('stuck1', file)) ?? null;
    });

    expect(id).toBe('d9');
    expect(sendDocumentSource).toHaveBeenCalledWith('d9', file);
    expect(deleteDocument.mock.calls).toEqual([['stuck1']]);
  });

  it('keeps the stuck letter when the new file does not get there', async () => {
    const deleteDocument = vi.fn<ApiClient['deleteDocument']>().mockResolvedValue(true);
    const sendDocumentSource = vi.fn<ApiClient['sendDocumentSource']>().mockRejectedValue(new Error('lost'));
    await open({ createDocument: created('d10'), sendDocumentSource, deleteDocument });

    let id: string | null = 'x';
    await act(async () => {
      id = (await box.retry?.retry('stuck1', new File(['x'], 'a.jpg', { type: 'image/jpeg' }))) ?? null;
    });

    expect(id).toBeNull();
    expect(deleteDocument.mock.calls).toEqual([['d10']]);
  });
});

describe('useAskDocument', () => {
  it('asks the trimmed question and keeps the answer', async () => {
    const answer = { question: 'how do I pay?', answer: 'By phone.', audio_url: null };
    const askDocument = vi.fn<ApiClient['askDocument']>().mockResolvedValue(answer);
    await open({ askDocument });

    await act(async () => {
      await box.ask?.ask('  how do I pay?  ');
    });

    expect(askDocument).toHaveBeenCalledWith('doc_water', 'how do I pay?');
    expect(box.ask?.answer).toEqual(answer);
    expect(box.ask?.asking).toBeNull();
  });
});
