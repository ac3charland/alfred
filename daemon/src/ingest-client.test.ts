import { createHmac } from 'node:crypto';

import type { IngestPayload, NormalizedMessage } from './contract.ts';
import { createIngestClient, sign } from './ingest-client.ts';
import type { FetchLike, FetchResponseLike } from './ingest-client.ts';
import { createLogger } from './log.ts';
import type { Logger } from './log.ts';

const SECRET = 'it-is-a-secret-to-everybody';
const INGEST_URL = 'https://worker.example.com/comms/ingest';
const AT = new Date('2025-01-01T00:00:00.000Z'); // unix 1735689600

const MESSAGE: NormalizedMessage = {
  source_id: 'guid-1',
  thread_key: 'chat-7',
  direction: 'inbound',
  sender_handle: '+15550100',
  participants: ['+15550100'],
  body: 'can you approve the invoice today?',
  received_at: '2025-01-01T00:00:00.000Z',
  body_extracted: true,
  has_attachments: false,
  references_ids: [],
};

function payload(overrides: Partial<IngestPayload> = {}): IngestPayload {
  return {
    version: 1,
    account: {
      key: 'imessage',
      kind: 'imessage',
      label: 'iMessage',
      owner_handles: ['+15550199'],
      expected_interval_seconds: 300,
    },
    heartbeat: { ok: true, cursor: { rowid: 42 } },
    messages: [],
    ...overrides,
  };
}

interface Sent {
  url: string;
  init: { method: string; headers: Record<string, string>; body: string };
}

function recordingFetch(answer: () => Promise<FetchResponseLike>): {
  sent: Sent[];
  fetch: FetchLike;
} {
  const sent: Sent[] = [];
  return {
    sent,
    fetch: (url, init) => {
      sent.push({ url, init });
      return answer();
    },
  };
}

function ok(body: string): () => Promise<FetchResponseLike> {
  return () => Promise.resolve({ ok: true, status: 200, text: () => Promise.resolve(body) });
}

/** A rejected response carrying a `Retry-After` header, however the transport spells the value. */
function withRetryAfter(status: number, value: string): () => Promise<FetchResponseLike> {
  return () =>
    Promise.resolve({
      ok: false,
      status,
      text: () => Promise.resolve('slow down'),
      headers: { get: (name) => (name.toLowerCase() === 'retry-after' ? value : undefined) },
    });
}

/** Logs are captured rather than printed; only the secret-leak test reads them back. */
function capturingLogger(sink: string[]): Logger {
  return createLogger({ out: (line) => sink.push(line), err: (line) => sink.push(line) });
}

function client(fetch: FetchLike): ReturnType<typeof createIngestClient> {
  return createIngestClient({
    ingestUrl: INGEST_URL,
    secret: SECRET,
    fetch,
    now: () => AT,
    log: capturingLogger([]),
  });
}

describe('sign', () => {
  it('matches a golden signature computed independently of this function', () => {
    // node -e "console.log(require('node:crypto').createHmac('sha256','it-is-a-secret-to-everybody')
    //   .update('1735689600.{\"version\":1,\"messages\":[]}').digest('hex'))"
    const golden = 'sha256=af4ac11baa75ca2c03277cbc981ba309951b4ff356d1d87d7608198deac96423';

    expect(sign(SECRET, 1_735_689_600, '{"version":1,"messages":[]}')).toBe(golden);
  });

  it('binds the signature to the timestamp, so a captured request cannot be replayed later', () => {
    const body = '{"version":1}';

    expect(sign(SECRET, 1_735_689_600, body)).not.toBe(sign(SECRET, 1_735_689_601, body));
  });

  it('binds the signature to the body, so a captured signature cannot carry other messages', () => {
    expect(sign(SECRET, 1, '{"a":1}')).not.toBe(sign(SECRET, 1, '{"a":2}'));
  });
});

describe('createIngestClient', () => {
  it('POSTs the signed payload with the timestamp and signature headers', async () => {
    const { sent, fetch } = recordingFetch(
      ok(
        '{"accepted":1,"duplicates":0,"drained":0,"cursor":{"rowid":42},"last_seen_at":"2025-01-01T00:00:00.000Z"}',
      ),
    );

    await client(fetch).send(payload({ messages: [MESSAGE] }));

    const [request] = sent;
    expect(request?.url).toBe(INGEST_URL);
    expect(request?.init.method).toBe('POST');
    expect(request?.init.headers['Content-Type']).toBe('application/json');
    expect(request?.init.headers['X-Alfred-Timestamp']).toBe('1735689600');
    const expected = createHmac('sha256', SECRET)
      .update(`1735689600.${request?.init.body ?? ''}`)
      .digest('hex');
    expect(request?.init.headers['X-Alfred-Signature']).toBe(`sha256=${expected}`);
  });

  it('sends the exact bytes it signed, omitting absent optional fields rather than nulling them', async () => {
    const { sent, fetch } = recordingFetch(ok('{"accepted":0,"duplicates":0,"drained":0}'));

    await client(fetch).send(payload());

    expect(sent[0]?.init.body).toBe(JSON.stringify(payload()));
    expect(sent[0]?.init.body).not.toContain('null');
  });

  it('returns the parsed response on 200', async () => {
    const { fetch } = recordingFetch(
      ok(
        '{"accepted":2,"duplicates":1,"drained":0,"cursor":{"rowid":51},"last_seen_at":"2025-01-01T00:00:00.000Z"}',
      ),
    );

    const result = await client(fetch).send(payload());

    expect(result).toEqual({
      ok: true,
      response: {
        accepted: 2,
        duplicates: 1,
        drained: 0,
        cursor: { rowid: 51 },
        last_seen_at: '2025-01-01T00:00:00.000Z',
      },
    });
  });

  it('reports a rejected signature as a failure rather than throwing', async () => {
    const { fetch } = recordingFetch(() =>
      Promise.resolve({ ok: false, status: 401, text: () => Promise.resolve('bad signature') }),
    );

    const result = await client(fetch).send(payload());

    expect(result.ok).toBe(false);
    expect(result.ok ? '' : result.error).toContain('401');
  });

  it('surfaces the status and marks a 401 non-retryable — a rotated secret needs a fix, not a faster retry', async () => {
    const { fetch } = recordingFetch(() =>
      Promise.resolve({ ok: false, status: 401, text: () => Promise.resolve('bad signature') }),
    );

    const result = await client(fetch).send(payload());

    expect(result).toMatchObject({ ok: false, status: 401, retryable: false });
  });

  it('marks every 4xx non-retryable, not only 401', async () => {
    const { fetch } = recordingFetch(() =>
      Promise.resolve({ ok: false, status: 400, text: () => Promise.resolve('bad body') }),
    );

    const result = await client(fetch).send(payload());

    expect(result).toMatchObject({ ok: false, status: 400, retryable: false });
  });

  it('marks a 5xx retryable — this is exactly the transient case retrying exists for', async () => {
    const { fetch } = recordingFetch(() =>
      Promise.resolve({ ok: false, status: 503, text: () => Promise.resolve('unconfigured') }),
    );

    const result = await client(fetch).send(payload());

    expect(result).toMatchObject({ ok: false, status: 503, retryable: true });
  });

  it.each([
    [429, 'Too Many Requests'],
    [408, 'Request Timeout'],
    [425, 'Too Early'],
  ])(
    'marks a %i (%s) retryable — this is about *when* to retry, not a rejected request',
    async (status) => {
      const { fetch } = recordingFetch(() =>
        Promise.resolve({ ok: false, status, text: () => Promise.resolve('try later') }),
      );

      const result = await client(fetch).send(payload());

      expect(result).toMatchObject({ ok: false, status, retryable: true });
    },
  );

  it('marks any status retryable when the response carries Retry-After, even inside the 4xx range', async () => {
    const { fetch } = recordingFetch(withRetryAfter(403, '30'));

    const result = await client(fetch).send(payload());

    expect(result).toMatchObject({ ok: false, status: 403, retryable: true });
  });

  it('still marks a plain 403 non-retryable — Retry-After is what flips it, not the status alone', async () => {
    const { fetch } = recordingFetch(() =>
      Promise.resolve({ ok: false, status: 403, text: () => Promise.resolve('forbidden') }),
    );

    const result = await client(fetch).send(payload());

    expect(result).toMatchObject({ ok: false, status: 403, retryable: false });
  });

  it('reports a transport failure as a failure rather than throwing', async () => {
    const { fetch } = recordingFetch(() => Promise.reject(new Error('ECONNREFUSED')));

    const result = await client(fetch).send(payload());

    expect(result.ok).toBe(false);
    expect(result.ok ? '' : result.error).toContain('ECONNREFUSED');
  });

  it('marks a transport failure retryable — a network blip is transient by nature, and carries no status at all', async () => {
    const { fetch } = recordingFetch(() => Promise.reject(new Error('ECONNREFUSED')));

    const result = await client(fetch).send(payload());

    expect(result).toMatchObject({ ok: false, retryable: true });
    expect(result.ok ? undefined : result.status).toBeUndefined();
  });

  it('reports an unparseable 200 body as a failure', async () => {
    const { fetch } = recordingFetch(ok('<html>proxy error</html>'));

    const result = await client(fetch).send(payload());

    expect(result.ok).toBe(false);
  });

  it('marks an unparseable 200 body retryable — it reads as a proxy hiccup, not a rejection', async () => {
    const { fetch } = recordingFetch(ok('<html>proxy error</html>'));

    const result = await client(fetch).send(payload());

    expect(result).toMatchObject({ ok: false, retryable: true, status: 200 });
  });

  it('never logs the secret', async () => {
    const lines: string[] = [];
    const { fetch } = recordingFetch(() => Promise.reject(new Error('ECONNREFUSED')));
    const logged = createIngestClient({
      ingestUrl: INGEST_URL,
      secret: SECRET,
      fetch,
      now: () => AT,
      log: capturingLogger(lines),
    });

    await logged.send(payload());

    expect(lines.join('')).not.toContain(SECRET);
  });
});
