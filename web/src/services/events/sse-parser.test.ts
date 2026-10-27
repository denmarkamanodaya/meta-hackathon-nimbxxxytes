import { describe, expect, it } from 'vitest';
import { createSseParser } from './sse-parser';

describe('createSseParser', () => {
  it('reads named and unnamed events, joining data lines with a newline', () => {
    const parser = createSseParser();

    const events = parser.push('event: local\ndata: {"a":\ndata: 1}\n\ndata: plain\n\n');

    expect(events).toEqual([
      { event: 'local', data: '{"a":\n1}' },
      { event: null, data: 'plain' },
    ]);
  });

  it('keeps an event split across chunks until its blank line arrives', () => {
    const parser = createSseParser();

    expect(parser.push('event: ran')).toEqual([]);
    expect(parser.push('ked\ndata: {"b"')).toEqual([]);
    expect(parser.push(':2}\r\n\r\n')).toEqual([{ event: 'ranked', data: '{"b":2}' }]);
  });

  it('drops comments, id and retry fields, and blank lines between events', () => {
    const parser = createSseParser();

    const events = parser.push(': keep-alive\n\nid: 7\nretry: 100\nevent: done\ndata\n\n\n');

    expect(events).toEqual([{ event: 'done', data: '' }]);
  });

  it('strips only one space after the colon', () => {
    const parser = createSseParser();

    expect(parser.push('data:  two\n\n')).toEqual([{ event: null, data: ' two' }]);
  });
});
