import type { NormalizedMessage } from './contract.ts';

/**
 * Messages polled but not yet accepted by the ingest endpoint.
 *
 * The ingest client retries nothing, so a failed POST leaves its batch here and the next tick
 * sends it again — the endpoint dedupes on each source's identity key, so a re-send is a no-op
 * rather than a duplicate.
 *
 * `limit` is a soft, advisory bound, not a hard cap. A message only ever lands here after a
 * source's `poll()` already returned it — which means the source's own cursor has already moved
 * past it, for good. Evicting the oldest held messages to stay under `limit`, as this buffer once
 * did, is silent and PERMANENT data loss: there is no cursor left to re-read them from. So `add`
 * keeps everything it is given, however large that makes the buffer, and `onOverflow` is purely a
 * loud alarm that the bound was exceeded — never a report of what got deleted, because nothing
 * is. Staying near `limit` in the first place is the runner's job: it only polls a source again
 * once this buffer is empty (see runner.ts), so a healthy daemon never hands this buffer more
 * than one poll's worth of messages at a time, and both current sources cap a single poll well
 * within `limit`. An overflow here means that invariant broke upstream, which is exactly why it
 * has to be loud rather than quietly patched over by dropping data.
 */

export const MAX_PENDING_MESSAGES = 500;

export interface PendingBufferOptions {
  limit?: number;
  /** Called with the buffer's size and its limit whenever a held batch exceeds it. A pure alarm
   * — the messages that triggered it are still held, not dropped. */
  onOverflow?: (size: number, limit: number) => void;
}

export interface PendingBuffer {
  add(messages: readonly NormalizedMessage[]): void;
  all(): NormalizedMessage[];
  size(): number;
  /** The configured bound `size()` is expected to stay under. Exposed so a caller can tell, on
   * its own, whether the buffer is currently over it — see runner.ts's heartbeat escalation. */
  limit(): number;
  clear(): void;
}

export function createPendingBuffer(options: PendingBufferOptions = {}): PendingBuffer {
  const limit = options.limit ?? MAX_PENDING_MESSAGES;
  let held: NormalizedMessage[] = [];

  return {
    add(messages) {
      held = [...held, ...messages];
      if (held.length > limit) {
        options.onOverflow?.(held.length, limit);
      }
    },
    all: () => [...held],
    size: () => held.length,
    limit: () => limit,
    clear() {
      held = [];
    },
  };
}
