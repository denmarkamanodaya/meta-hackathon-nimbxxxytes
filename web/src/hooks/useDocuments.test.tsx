// Adding a letter: register it, PUT the file with the type the URL was signed for, complete it.
// Asking about it keeps the answer. A file the API cannot read never leaves the device.
import { act, useEffect } from 'react';
import { MemoryRouter } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ApiClient } from '../services/api/client';
import { fakeApi, fakeServices, mount, type Mounted } from '../test-support/services';
import { useAddDocument, useAskDocument, type AddDocument, type AskDocument } from './useDocuments';

let view: Mounted | null = null;
afterEach(() => {
  view?.unmount();
  view = null;
});

const box: { add: AddDocument | null; ask: AskDocument | null } = { add: null, ask: null };

function Probe() {
  const add = useAddDocument();
  const ask = useAskDocument('doc_water');
  useEffect(() => {
    box.add = add;
    box.ask = ask;
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

describe('useAddDocument', () => {
  it('creates, PUTs the file to the presigned URL, then completes, and resolves the id', async () => {
    const createDocument = vi.fn<ApiClient['createDocument']>().mockResolvedValue({ document_id: 'd1', upload_url: 'https://r2/put' });
    const completeDocument = vi.fn<ApiClient['completeDocument']>().mockResolvedValue({ document_id: 'd1', status: 'reading' });
    const { putFile } = await open({ createDocument, completeDocument });
    const file = new File(['jpeg'], 'bill.jpg', { type: 'image/jpeg' });

    let id: string | null = null;
    await act(async () => {
      id = await add(file);
    });

    expect(createDocument).toHaveBeenCalledWith({ filename: 'bill.jpg', content_type: 'image/jpeg', size_bytes: 4 });
    expect(putFile).toHaveBeenCalledWith('https://r2/put', file, expect.any(Function), expect.any(AbortSignal));
    expect(completeDocument).toHaveBeenCalledWith('d1');
    expect(id).toBe('d1');
  });

  it('sends a typeless PDF with the type read from its name, so the PUT matches the signed type', async () => {
    const createDocument = vi.fn<ApiClient['createDocument']>().mockResolvedValue({ document_id: 'd2', upload_url: 'https://r2/put' });
    const { putFile } = await open({ createDocument, completeDocument: vi.fn<ApiClient['completeDocument']>().mockResolvedValue({ document_id: 'd2', status: 'reading' }) });

    await act(async () => {
      await add(new File(['%PDF'], 'Rates.pdf', { type: '' }));
    });

    expect(createDocument.mock.calls[0]?.[0].content_type).toBe('application/pdf');
    const sent = (putFile.mock.calls[0] as unknown as [string, Blob] | undefined)?.[1];
    expect(sent?.type).toBe('application/pdf');
  });

  it('keeps a file the API cannot read on the device and says why', async () => {
    const createDocument = vi.fn<ApiClient['createDocument']>();
    const { putFile, toasts } = await open({ createDocument });

    let id: string | null = 'x';
    await act(async () => {
      id = await add(new File(['x'], 'clip.mov', { type: 'video/quicktime' }));
    });

    expect(id).toBeNull();
    expect(createDocument).not.toHaveBeenCalled();
    expect(putFile).not.toHaveBeenCalled();
    expect(toasts.getSnapshot()[0]?.title).toBe('This file cannot be read');
  });

  it('resolves null with a toast when the upload fails, and never completes', async () => {
    const completeDocument = vi.fn<ApiClient['completeDocument']>();
    const services = fakeServices({
      api: fakeApi({ createDocument: vi.fn<ApiClient['createDocument']>().mockResolvedValue({ document_id: 'd3', upload_url: 'u' }), completeDocument }),
      putFile: vi.fn(() => Promise.reject(new Error('lost'))),
    });
    view = await mount(
      <MemoryRouter>
        <Probe />
      </MemoryRouter>,
      services,
    );

    let id: string | null = 'x';
    await act(async () => {
      id = await add(new File(['x'], 'a.png', { type: 'image/png' }));
    });

    expect(id).toBeNull();
    expect(completeDocument).not.toHaveBeenCalled();
    expect(services.toasts.getSnapshot()[0]?.title).toBe('Could not add the letter');
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
