import { describe, expect, it } from 'vitest';
import { base64ToBytes, bytesToBase64 } from './body-base64';

describe('body base64', () => {
  it('encodes bytes as standard base64 and back', () => {
    const bytes = new Uint8Array([0, 1, 2, 250, 255]);

    expect(bytesToBase64(bytes)).toBe('AAEC+v8=');
    expect([...base64ToBytes('AAEC+v8=')]).toEqual([...bytes]);
  });

  it('keeps a body longer than one chunk whole', () => {
    const bytes = Uint8Array.from({ length: 70_000 }, (_, i) => i % 256);

    expect([...base64ToBytes(bytesToBase64(bytes))]).toEqual([...bytes]);
  });
});
