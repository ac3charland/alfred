import type { IngestPayload } from './contract.ts';
import { createIngestClient } from './ingest-client.ts';
import { createLogger } from './log.ts';
import { toFetchResponseLike } from './main.ts';

/**
 * `main.ts` is a thin composition root with no test file of its own — everything it wires up is
 * tested where it lives. `toFetchResponseLike` is the one exception: it is the real transport's
 * adapter from a platform `fetch` `Response` into the shape `ingest-client.ts`'s `FetchLike`
 * expects, and it used to drop response headers entirely, silently disabling the Retry-After
 * branch `ingest-client.ts` implements. That is load-bearing enough to test directly, extracted
 * out of the composition root rather than left un-exercised inside it.
 */

const INGEST_URL = 'https://worker.example.com/comms/ingest';
/** Log output is captured and never asserted on. */
const captured: string[] = [];
const silent = createLogger({
  out: (line) => captured.push(line),
  err: (line) => captured.push(line),
});

function payload(): IngestPayload {
  return {
    version: 1,
    account: {
      key: 'imessage',
      kind: 'imessage',
      label: 'iMessage',
      owner_handles: ['+15550199'],
      expected_interval_seconds: 300,
    },
    heartbeat: { ok: true },
    messages: [],
  };
}

describe('toFetchResponseLike', () => {
  it('forwards a present header verbatim', () => {
    const response = new Response(undefined, { status: 429, headers: { 'Retry-After': '30' } });

    expect(toFetchResponseLike(response).headers?.get('retry-after')).toBe('30');
  });

  it("maps a missing header to undefined, not DOM's null", () => {
    // Load-bearing, not cosmetic: ingest-client.ts's Retry-After check is `!== undefined`, and
    // `null !== undefined` is true in JS — passing a raw `Headers.get()` result through unchanged
    // would mark every response retryable via the Retry-After branch, header present or not.
    const response = new Response(undefined, { status: 200 });

    expect(toFetchResponseLike(response).headers?.get('retry-after')).toBeUndefined();
  });

  it('wires a real Retry-After response through to a retryable verdict end-to-end', async () => {
    // The regression this guards: httpFetch used to construct `{ ok, status, text }` and drop
    // headers entirely, so against the real transport ingest-client's Retry-After branch never
    // fired. 403 alone is not in ingest-client's retryable-4xx set, so this only passes because
    // the header actually reaches the client.
    const response = new Response(undefined, { status: 403, headers: { 'Retry-After': '30' } });
    const client = createIngestClient({
      ingestUrl: INGEST_URL,
      secret: 'shh',
      log: silent,
      fetch: () => Promise.resolve(toFetchResponseLike(response)),
    });

    const result = await client.send(payload());

    expect(result).toMatchObject({ ok: false, status: 403, retryable: true });
  });

  it('does not manufacture retryability when Retry-After is simply absent', async () => {
    const response = new Response(undefined, { status: 403 });
    const client = createIngestClient({
      ingestUrl: INGEST_URL,
      secret: 'shh',
      log: silent,
      fetch: () => Promise.resolve(toFetchResponseLike(response)),
    });

    const result = await client.send(payload());

    expect(result).toMatchObject({ ok: false, status: 403, retryable: false });
  });
});
