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
 *
 * A failure carries a `retryable` verdict alongside its status, because the two failure shapes
 * mean opposite things: a 4xx means the endpoint rejected THIS request outright — a rotated HMAC
 * secret, a malformed body — and sending the same bytes again will fail identically every time. A
 * 5xx, or no response at all (DNS, a dropped connection), is the ordinary transient case retrying
 * exists for. The poll loop is what actually decides what to do with that verdict (backing off,
 * escalating a persistent 4xx to something loud) — this module only classifies what happened.
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

export type SendResult =
  | { ok: true; response: IngestResponse }
  | {
      ok: false;
      error: string;
      /** Whether trying again might succeed. False for a 4xx: the request itself was rejected, and
       * an unmodified retry fails identically every time. Absent on a pure transport failure —
       * there was no response to carry one. */
      retryable: boolean;
      status?: number;
    };

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

/**
 * 4xx means the request itself was malformed or unauthorized — bad signature, bad body, an
 * unconfigured secret — and resending the same bytes will fail identically every time. Everything
 * else in the "not ok" range (5xx, and anything unconventional) reads as the endpoint or the path
 * to it having a bad moment, which is exactly the transient case retrying is for.
 */
function isRetryableStatus(status: number): boolean {
  return !(status >= 400 && status < 500);
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
        // No response at all — a network-level failure (DNS, connection refused, a dropped
        // connection) is exactly the transient case retrying exists for, so there is no status to
        // carry and nothing here says "don't try again."
        return { ok: false, error: message, retryable: true };
      }

      if (!response.ok) {
        const retryable = isRetryableStatus(response.status);
        const message = `ingest POST rejected with ${String(response.status)}`;
        options.log.warn(message, {
          url: options.ingestUrl,
          messages: payload.messages.length,
          status: response.status,
          retryable,
        });
        return { ok: false, error: message, status: response.status, retryable };
      }

      try {
        const parsed = JSON.parse(await response.text()) as IngestResponse;
        return { ok: true, response: parsed };
      } catch (error) {
        const message = `ingest response was not JSON: ${describe(error)}`;
        options.log.warn(message, { url: options.ingestUrl, status: response.status });
        // A 2xx status with a body that will not parse reads as an edge or proxy hiccup, not a
        // rejection of the request — treat it like the transient failure it almost certainly is.
        return { ok: false, error: message, status: response.status, retryable: true };
      }
    },
  };
}
