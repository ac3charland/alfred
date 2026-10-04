import {
  MOVE_SYNC_DEBOUNCE_MS,
  PrioritySync,
  type PriorityWrite,
  SEND_TIMEOUT_MS,
} from '@/lib/stores/code-priority-sync';
import type { CodeItem } from '@/lib/types';

function row(itemId: string, priority: number): CodeItem {
  return { item_id: itemId, priority } as CodeItem;
}

function swap(a: string, b: string): PriorityWrite {
  return {
    kind: 'swap',
    ref: a,
    neighbourRef: b,
    touched: [
      { itemId: a, priorityBefore: 1 },
      { itemId: b, priorityBefore: 2 },
    ],
  };
}

function makeSync(send: (write: PriorityWrite) => Promise<CodeItem[]>) {
  const restored: [string, number | null][] = [];
  const failures: PriorityWrite[] = [];
  const sync = new PrioritySync({
    send,
    patchRow: jest.fn(),
    restorePriority: (itemId, priority) => restored.push([itemId, priority]),
  });
  sync.setFailureHandler((write) => failures.push(write));
  return { sync, restored, failures };
}

describe('PrioritySync', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('gives up on a request that never settles: rolls it back, reports it, and sends the next', async () => {
    const send = jest
      .fn<Promise<CodeItem[]>, [PriorityWrite]>()
      .mockReturnValueOnce(new Promise(() => {}))
      .mockResolvedValue([]);
    const { sync, restored, failures } = makeSync(send);

    sync.enqueue(swap('a', 'b'));
    await jest.advanceTimersByTimeAsync(MOVE_SYNC_DEBOUNCE_MS);
    expect(sync.isHeld('a')).toBe(true);

    await jest.advanceTimersByTimeAsync(SEND_TIMEOUT_MS);
    expect(restored).toEqual([
      ['b', 2],
      ['a', 1],
    ]);
    expect(failures).toHaveLength(1);
    expect(sync.isHeld('a')).toBe(false);

    // The queue is not wedged: a later click still reaches the server.
    sync.enqueue(swap('c', 'd'));
    await jest.advanceTimersByTimeAsync(MOVE_SYNC_DEBOUNCE_MS);
    expect(send).toHaveBeenCalledTimes(2);
  });

  it('spends a matching own-write record even when the echo lands while the story is held', async () => {
    const second: { settle?: (rows: CodeItem[]) => void } = {};
    const send = jest
      .fn<Promise<CodeItem[]>, [PriorityWrite]>()
      .mockResolvedValueOnce([row('a', 2), row('b', 1)])
      .mockReturnValueOnce(
        new Promise((resolve) => {
          second.settle = resolve;
        }),
      );
    const { sync } = makeSync(send);

    sync.enqueue(swap('a', 'b'));
    await jest.advanceTimersByTimeAsync(MOVE_SYNC_DEBOUNCE_MS);
    sync.enqueue(swap('a', 'c'));
    await jest.advanceTimersByTimeAsync(MOVE_SYNC_DEBOUNCE_MS);

    // The first swap's own echo arrives while the second swap still holds `a`: skipped, and its
    // record spent.
    expect(sync.acceptsEchoPriority(row('a', 2))).toBe(false);

    second.settle?.([row('a', 3), row('c', 2)]);
    await jest.advanceTimersByTimeAsync(0);
    expect(sync.acceptsEchoPriority(row('a', 3))).toBe(false);
    // Another device then moves `a` back to 2 — a real change, not a leftover echo.
    expect(sync.acceptsEchoPriority(row('a', 2))).toBe(true);
  });

  it('forgets an own-write record once its echo is overdue, so a later real change applies', async () => {
    const send = jest
      .fn<Promise<CodeItem[]>, [PriorityWrite]>()
      .mockResolvedValue([row('a', 2), row('b', 1)]);
    const { sync } = makeSync(send);

    sync.enqueue(swap('a', 'b'));
    await jest.advanceTimersByTimeAsync(MOVE_SYNC_DEBOUNCE_MS);
    await jest.advanceTimersByTimeAsync(10_001);

    expect(sync.acceptsEchoPriority(row('a', 2))).toBe(true);
  });
});
