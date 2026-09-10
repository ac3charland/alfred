import type { NormalizedMessage } from './contract.ts';

/**
 * Messages polled but not yet accepted by the ingest endpoint.
 *
 * The ingest client retries nothing, so a failed POST leaves its batch here and the next tick
 * sends it again — the endpoint dedupes on each source's identity key, so a re-send is a no-op
 * rather than a duplicate. The buffer is bounded because an endpoint that stays down must not
 * grow the daemon's heap without limit; past the cap the OLDEST messages are dropped (the newest
 * are the ones most likely still to matter) and every drop is reported loudly.
 */

export const MAX_PENDING_MESSAGES = 500;

export interface PendingBufferOptions {
  limit?: number;
  /** Called with the number of messages dropped. Never silent. */
  onOverflow?: (dropped: number) => void;
}

export interface PendingBuffer {
  add(messages: readonly NormalizedMessage[]): void;
  all(): NormalizedMessage[];
  size(): number;
  clear(): void;
}

export function createPendingBuffer(options: PendingBufferOptions = {}): PendingBuffer {
  const limit = options.limit ?? MAX_PENDING_MESSAGES;
  let held: NormalizedMessage[] = [];

  return {
    add(messages) {
      held = [...held, ...messages];
      if (held.length > limit) {
        const dropped = held.length - limit;
        held = held.slice(dropped);
        options.onOverflow?.(dropped);
      }
    },
    all: () => [...held],
    size: () => held.length,
    clear() {
      held = [];
    },
  };
}
