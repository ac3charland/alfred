import type { NormalizedMessage } from './contract.ts';
import { MAX_PENDING_MESSAGES, createPendingBuffer } from './pending.ts';

function message(id: string): NormalizedMessage {
  return {
    source_id: id,
    thread_key: 'chat-1',
    direction: 'inbound',
    sender_handle: '+15550100',
    participants: ['+15550100'],
    body: id,
    received_at: '2026-09-09T12:00:00.000Z',
    body_extracted: true,
    has_attachments: false,
    references_ids: [],
  };
}

function messages(count: number, offset = 0): NormalizedMessage[] {
  return Array.from({ length: count }, (_unused, index) => message(`m${String(index + offset)}`));
}

describe('createPendingBuffer', () => {
  it('holds what has not been accepted yet, so a failed POST is retried on the next tick', () => {
    const buffer = createPendingBuffer();

    buffer.add(messages(2));

    expect(buffer.all().map((m) => m.source_id)).toEqual(['m0', 'm1']);
    expect(buffer.size()).toBe(2);
  });

  it('empties once the endpoint has accepted the batch', () => {
    const buffer = createPendingBuffer();
    buffer.add(messages(2));

    buffer.clear();

    expect(buffer.all()).toEqual([]);
  });

  it('caps at five hundred messages, dropping the oldest first', () => {
    const buffer = createPendingBuffer();

    buffer.add(messages(MAX_PENDING_MESSAGES));
    buffer.add(messages(2, MAX_PENDING_MESSAGES));

    expect(buffer.size()).toBe(MAX_PENDING_MESSAGES);
    expect(buffer.all()[0]?.source_id).toBe('m2');
    expect(buffer.all().at(-1)?.source_id).toBe(`m${String(MAX_PENDING_MESSAGES + 1)}`);
  });

  it('reports every drop loudly — a lost message is never silent', () => {
    const dropped: number[] = [];
    const buffer = createPendingBuffer({ limit: 3, onOverflow: (count) => dropped.push(count) });

    buffer.add(messages(5));

    expect(dropped).toEqual([2]);
    expect(buffer.size()).toBe(3);
  });

  it('does not report a drop when the batch fits', () => {
    const dropped: number[] = [];
    const buffer = createPendingBuffer({ limit: 3, onOverflow: (count) => dropped.push(count) });

    buffer.add(messages(3));

    expect(dropped).toEqual([]);
  });
});
