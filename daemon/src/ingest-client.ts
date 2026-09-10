import { createHmac } from 'node:crypto';

import type { IngestPayload, IngestResponse } from './contract.ts';
import type { Logger } from './log.ts';

/**
 * Signs and POSTs one payload to the ingest endpoint. This is the only place the daemon talks to
 * the network, and the only place the HMAC secret is used.
 *
 * The wire contract, which the endpoint implements exactly:
 *
 *   POST {ingestUrl}
 *   Content-Type:      application/json
 *   X-Alfred-Timestamp: <unix seconds, integer>
 *   X-Alfred-Signature: sha256=<hex HMAC-SHA256(secret, `${timestamp}.${rawBody}`)>
 *
 *   200 → { accepted, duplicates, drained, cursor, last_seen_at }
 *   401 → bad or stale signature   400 → bad body   503 → unconfigured
 *
 * The timestamp is inside the signed string, so a captured request cannot be replayed later to
 * resurrect old messages, and the signature is over the exact bytes sent, so it cannot be lifted
 * onto a different body.
 *
 * The client retries NOTHING. A failed POST is reported to the caller, which keeps the batch in
 * memory for the next tick — retry policy belongs to the poll loop, which already has a clock.
 */

export interface FetchResponseLike {
  ok: boolean;
  status: number;
  text: () => Promise<string>;
}

export type FetchLike = (
  url: string,
  init: { method: string; headers: Record<string, string>; body: string },
) => Promise<FetchResponseLike>;

export interface IngestClientOptions {
  ingestUrl: string;
  secret: string;
  fetch: FetchLike;
  log: Logger;
  now?: () => Date;
}

export type SendResult = { ok: true; response: IngestResponse } | { ok: false; error: string };

export interface IngestClient {
  send(payload: IngestPayload): Promise<SendResult>;
}

/** The full `X-Alfred-Signature` header value for a body at a moment. */
export function sign(secret: string, timestamp: number, rawBody: string): string {
  const digest = createHmac('sha256', secret)
    .update(`${String(timestamp)}.${rawBody}`)
    .digest('hex');
  return `sha256=${digest}`;
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function createIngestClient(options: IngestClientOptions): IngestClient {
  const now = options.now ?? ((): Date => new Date());

  return {
    async send(payload: IngestPayload): Promise<SendResult> {
      const body = JSON.stringify(payload);
      const timestamp = Math.floor(now().getTime() / 1000);

      let response: FetchResponseLike;
      try {
        response = await options.fetch(options.ingestUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Alfred-Timestamp': String(timestamp),
            'X-Alfred-Signature': sign(options.secret, timestamp, body),
          },
          body,
        });
      } catch (error) {
        const message = `ingest POST failed: ${describe(error)}`;
        options.log.warn(message, { url: options.ingestUrl, messages: payload.messages.length });
        return { ok: false, error: message };
      }

      if (!response.ok) {
        const message = `ingest POST rejected with ${String(response.status)}`;
        options.log.warn(message, { url: options.ingestUrl, messages: payload.messages.length });
        return { ok: false, error: message };
      }

      try {
        const parsed = JSON.parse(await response.text()) as IngestResponse;
        return { ok: true, response: parsed };
      } catch (error) {
        const message = `ingest response was not JSON: ${describe(error)}`;
        options.log.warn(message, { url: options.ingestUrl });
        return { ok: false, error: message };
      }
    },
  };
}
