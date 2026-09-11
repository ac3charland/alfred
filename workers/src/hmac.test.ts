import { hmacSha256Hex, verifySignature, verifyTimestampedSignature } from './hmac';

const SECRET = 'it-is-a-secret-to-everybody';
const BODY = '{"action":"opened","number":42}';

// A golden signature computed with an independent tool (node's createHmac) for (SECRET, BODY).
// Hard-coded so the "accepts" case is verified against an oracle, not against our own impl.
const GOLDEN = 'sha256=35619ab1fed8d5a27308088263925d091df2730285d9663867ba4f5f0af67381';

/** Sign GitHub-style with Web Crypto (the impl primitive) for the negative/tamper cases. */
async function sign(secret: string, body: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const signature = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(body));
  const hex = [...new Uint8Array(signature)]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
  return `sha256=${hex}`;
}

describe('verifySignature', () => {
  it('accepts a signature matching an independent oracle', async () => {
    await expect(verifySignature(SECRET, BODY, GOLDEN)).resolves.toBe(true);
  });

  it('rejects a signature computed with the wrong secret', async () => {
    const header = await sign('the-wrong-secret', BODY);
    await expect(verifySignature(SECRET, BODY, header)).resolves.toBe(false);
  });

  it('rejects when the body has been tampered with', async () => {
    await expect(verifySignature(SECRET, `${BODY} tampered`, GOLDEN)).resolves.toBe(false);
  });

  it('rejects a missing header', async () => {
    await expect(verifySignature(SECRET, BODY)).resolves.toBe(false);
  });

  it('rejects a header without the sha256= prefix', async () => {
    await expect(verifySignature(SECRET, BODY, GOLDEN.replace('sha256=', ''))).resolves.toBe(false);
  });

  it('rejects a header longer than the expected signature (trailing junk)', async () => {
    // A correct prefix with extra trailing bytes. The constant-time compare must reject on the
    // length mismatch FIRST — without that guard, the loop over the shorter `expected` would see
    // every byte match and wrongly accept.
    await expect(verifySignature(SECRET, BODY, `${GOLDEN}deadbeef`)).resolves.toBe(false);
  });
});

// ── The ingest endpoint's timestamped signature ──────────────────────────────

const COMMS_SECRET = 'the-daemon-and-the-worker-share-this';
const INGEST_BODY = '{"version":1,"messages":[]}';
const INGEST_TIMESTAMP = '1789430400';

/** The instant the timestamp above names, so "now" and the header always agree. */
const INGEST_NOW = new Date('2026-09-15T00:00:00.000Z');

// Another golden, computed with the same independent oracle over `${timestamp}.${body}` — the
// oracle for the daemon's end of the contract as much as for this one.
const INGEST_GOLDEN = 'sha256=b4a7060e1f9b03f976c14ebd4551d58571c4a6d2268e112a4edd024b9692390a';

/** Sign the timestamped payload with Web Crypto (the impl primitive), for the negative cases. */
function signIngest(secret: string, timestamp: string, body: string): Promise<string> {
  return sign(secret, `${timestamp}.${body}`);
}

/** Shift `now` by `seconds`, to walk a request in and out of the replay window. */
function nowPlus(seconds: number): Date {
  return new Date(INGEST_NOW.getTime() + seconds * 1000);
}

describe('verifyTimestampedSignature', () => {
  it('accepts a signature matching an independent oracle', async () => {
    await expect(
      verifyTimestampedSignature(
        COMMS_SECRET,
        INGEST_BODY,
        INGEST_TIMESTAMP,
        INGEST_GOLDEN,
        INGEST_NOW,
      ),
    ).resolves.toEqual({ ok: true });
  });

  it('rejects a missing timestamp header', async () => {
    await expect(
      verifyTimestampedSignature(COMMS_SECRET, INGEST_BODY, undefined, INGEST_GOLDEN, INGEST_NOW),
    ).resolves.toEqual({ ok: false, reason: 'missing' });
  });

  it('rejects a missing signature header', async () => {
    await expect(
      verifyTimestampedSignature(
        COMMS_SECRET,
        INGEST_BODY,
        INGEST_TIMESTAMP,
        undefined,
        INGEST_NOW,
      ),
    ).resolves.toEqual({ ok: false, reason: 'missing' });
  });

  it('rejects a timestamp that is not a whole count of seconds', async () => {
    // Not a timestamp at all, so there is nothing to compare the clock against — and the signed
    // string is built from the parsed integer, so accepting one shape and signing another would
    // fail later and more confusingly.
    const header = await signIngest(COMMS_SECRET, '1789430400.5', INGEST_BODY);
    await expect(
      verifyTimestampedSignature(COMMS_SECRET, INGEST_BODY, '1789430400.5', header, INGEST_NOW),
    ).resolves.toEqual({ ok: false, reason: 'missing' });
  });

  it('rejects a request older than the tolerance', async () => {
    await expect(
      verifyTimestampedSignature(
        COMMS_SECRET,
        INGEST_BODY,
        INGEST_TIMESTAMP,
        INGEST_GOLDEN,
        nowPlus(301),
      ),
    ).resolves.toEqual({ ok: false, reason: 'stale' });
  });

  it('rejects a request dated further into the future than the tolerance', async () => {
    // Both directions, because a captured request replayed from a machine with a fast clock is
    // the same attack seen from the other side.
    await expect(
      verifyTimestampedSignature(
        COMMS_SECRET,
        INGEST_BODY,
        INGEST_TIMESTAMP,
        INGEST_GOLDEN,
        nowPlus(-301),
      ),
    ).resolves.toEqual({ ok: false, reason: 'stale' });
  });

  it('accepts a request at the edge of the tolerance', async () => {
    await expect(
      verifyTimestampedSignature(
        COMMS_SECRET,
        INGEST_BODY,
        INGEST_TIMESTAMP,
        INGEST_GOLDEN,
        nowPlus(300),
      ),
    ).resolves.toEqual({ ok: true });
  });

  it('honours a caller-supplied tolerance', async () => {
    await expect(
      verifyTimestampedSignature(
        COMMS_SECRET,
        INGEST_BODY,
        INGEST_TIMESTAMP,
        INGEST_GOLDEN,
        nowPlus(301),
        { toleranceSeconds: 600 },
      ),
    ).resolves.toEqual({ ok: true });
  });

  it('rejects a tampered body', async () => {
    await expect(
      verifyTimestampedSignature(
        COMMS_SECRET,
        `${INGEST_BODY} tampered`,
        INGEST_TIMESTAMP,
        INGEST_GOLDEN,
        INGEST_NOW,
      ),
    ).resolves.toEqual({ ok: false, reason: 'mismatch' });
  });

  it('rejects a signature computed with the wrong secret', async () => {
    const header = await signIngest('the-wrong-secret', INGEST_TIMESTAMP, INGEST_BODY);
    await expect(
      verifyTimestampedSignature(COMMS_SECRET, INGEST_BODY, INGEST_TIMESTAMP, header, INGEST_NOW),
    ).resolves.toEqual({ ok: false, reason: 'mismatch' });
  });

  it('rejects a signature that signed a different timestamp than the header carries', async () => {
    // The timestamp is INSIDE the signature for exactly this reason: a captured request cannot be
    // re-dated to walk it back into the window, because moving the header breaks the signature.
    const header = await signIngest(COMMS_SECRET, '1789430000', INGEST_BODY);
    await expect(
      verifyTimestampedSignature(COMMS_SECRET, INGEST_BODY, INGEST_TIMESTAMP, header, INGEST_NOW),
    ).resolves.toEqual({ ok: false, reason: 'mismatch' });
  });

  it('rejects a header without the sha256= prefix', async () => {
    await expect(
      verifyTimestampedSignature(
        COMMS_SECRET,
        INGEST_BODY,
        INGEST_TIMESTAMP,
        INGEST_GOLDEN.replace('sha256=', ''),
        INGEST_NOW,
      ),
    ).resolves.toEqual({ ok: false, reason: 'mismatch' });
  });
});

describe('hmacSha256Hex', () => {
  it('matches the independent oracle, so both ends of the contract can be signed with it', async () => {
    await expect(hmacSha256Hex(COMMS_SECRET, `${INGEST_TIMESTAMP}.${INGEST_BODY}`)).resolves.toBe(
      INGEST_GOLDEN.replace('sha256=', ''),
    );
  });
});
