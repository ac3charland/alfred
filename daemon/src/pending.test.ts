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

  it('exposes its configured limit, defaulting to MAX_PENDING_MESSAGES', () => {
    expect(createPendingBuffer().limit()).toBe(MAX_PENDING_MESSAGES);
    expect(createPendingBuffer({ limit: 3 }).limit()).toBe(3);
  });

  it('never evicts a held message past its limit — a message only gets here because its source cursor already moved past it, so dropping it would be permanent, unrecoverable loss', () => {
    const buffer = createPendingBuffer({ limit: 3 });

    buffer.add(messages(3));
    buffer.add(messages(2, 3));

    expect(buffer.size()).toBe(5);
    expect(buffer.all().map((m) => m.source_id)).toEqual(['m0', 'm1', 'm2', 'm3', 'm4']);
  });

  it('reports an overflow loudly instead of silently absorbing it', () => {
    const overflows: { size: number; limit: number }[] = [];
    const buffer = createPendingBuffer({
      limit: 3,
      onOverflow: (size, limit) => overflows.push({ size, limit }),
    });

    buffer.add(messages(5));

    expect(overflows).toEqual([{ size: 5, limit: 3 }]);
    expect(buffer.size()).toBe(5);
  });

  it('does not report an overflow when the batch fits', () => {
    const overflows: unknown[] = [];
    const buffer = createPendingBuffer({
      limit: 3,
      onOverflow: (size, limit) => overflows.push({ size, limit }),
    });

    buffer.add(messages(3));

    expect(overflows).toEqual([]);
  });
});
