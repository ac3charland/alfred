/**
 * Verify the two signatures this Worker accepts: GitHub's webhook signature, and the Mac
 * daemon's timestamped signature over the comms ingest body.
 *
 * GitHub signs each delivery with `HMAC-SHA256(secret, rawBody)` and sends it as
 * `X-Hub-Signature-256: sha256=<hex>`. We recompute it with Web Crypto (`crypto.subtle` — no
 * `nodejs_compat` needed) and compare CONSTANT-TIME so a wrong signature can't be brute-forced a
 * byte at a time. Reject mismatches with 401 so ticket state can't be forged.
 *
 * The comms endpoint signs `${timestamp}.${rawBody}` instead of the body alone, because a
 * signature over the body alone is replayable forever — capture one request and it stays valid,
 * which for an ingest endpoint means old messages can be resurrected at will. Putting the
 * timestamp inside the signed string binds each request to a moment as well as to its bytes, and
 * the tolerance window is what turns that into a rejection. GitHub's contract is fixed by GitHub
 * and cannot move, so the two live side by side rather than one replacing the other.
 *
 * Note: we hand-roll the constant-time byte compare instead of `crypto.subtle.timingSafeEqual`
 * — the latter is a Workers-runtime extension absent from Node's Web Crypto, so the hand-rolled
 * version is what lets these run identically under jest and on the edge.
 */

const encoder = new TextEncoder();

/** Lowercase hex of an ArrayBuffer. */
function toHex(buffer: ArrayBuffer): string {
  return [...new Uint8Array(buffer)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

/** Constant-time string compare: same length always, XOR-accumulate every char. */
function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let mismatch = 0;
  // Stryker disable next-line EqualityOperator: AT_CEILING — <→<= only adds one iteration at i=a.length where both a.codePointAt and b.codePointAt are undefined→0 (the lengths are already known equal), XOR 0; unobservable.
  for (let i = 0; i < a.length; i++) {
    mismatch |= (a.codePointAt(i) ?? 0) ^ (b.codePointAt(i) ?? 0);
  }
  return mismatch === 0;
}

/**
 * Recompute the signature over `rawBody` and compare it constant-time to the header GitHub sent.
 * `signatureHeader` is the full `X-Hub-Signature-256` value (e.g. `sha256=abc…`); a missing or
 * malformed header is a rejection. The raw body string MUST be the exact bytes GitHub signed, so
 * read it with `request.text()` BEFORE any JSON parse.
 */
export async function verifySignature(
  secret: string,
  rawBody: string,
  signatureHeader?: string,
): Promise<boolean> {
  // Stryker disable next-line StringLiteral: AT_CEILING — 'sha256='→'' makes the prefix check always pass, but `expected` always starts with 'sha256=', so any header lacking the prefix still fails the constant-time compare below; the result is identical either way.
  if (!signatureHeader?.startsWith('sha256=')) return false;

  const expected = `sha256=${await hmacSha256Hex(secret, rawBody)}`;

  return constantTimeEqual(expected, signatureHeader);
}

/**
 * Lowercase hex of `HMAC-SHA256(secret, message)`. Exported because it is also how the OTHER end
 * of the comms contract signs: whatever produces an ingest request has to compute the identical
 * string, and there is one implementation of it here rather than one per caller.
 */
export async function hmacSha256Hex(secret: string, message: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    // Stryker disable next-line BooleanLiteral: AT_CEILING — this is importKey's `extractable` flag; false→true changes only whether the key could be exported, never the signature it produces, so verification behaviour is unchanged.
    false,
    ['sign'],
  );
  const signature = await crypto.subtle.sign('HMAC', key, encoder.encode(message));
  return toHex(signature);
}

/** How far apart the two clocks may be before a request is treated as a replay. */
export const DEFAULT_TOLERANCE_SECONDS = 300;

/**
 * Why a timestamped signature was refused. Three reasons rather than a boolean because they mean
 * different things to whoever sent the request: `missing` is a client that never signed at all,
 * `stale` is a correctly-signed request that arrived (or was replayed) outside the window, and
 * `mismatch` is a signature that does not belong to these bytes.
 */
export type TimestampedSignatureResult =
  | { ok: true }
  | { ok: false; reason: 'missing' | 'stale' | 'mismatch' };

/**
 * Verify a `sha256=<hex>` signature computed over `${timestamp}.${rawBody}`, where `timestamp` is
 * a whole count of unix seconds sent alongside it in its own header.
 *
 * Both headers are required, the timestamp must be within `toleranceSeconds` of `now` in EITHER
 * direction (a replay from a machine with a fast clock is the same attack seen from the other
 * side), and the signature is compared constant-time. The signed string is built from the PARSED
 * integer, so a header that is not one is refused up front rather than silently signing something
 * else. As with GitHub's, the raw body must be the exact bytes that were signed — read it with
 * `request.text()` BEFORE any JSON parse.
 */
export async function verifyTimestampedSignature(
  secret: string,
  rawBody: string,
  timestampHeader: string | undefined,
  signatureHeader: string | undefined,
  now: Date,
  options: { toleranceSeconds?: number } = {},
): Promise<TimestampedSignatureResult> {
  if (
    timestampHeader === undefined ||
    timestampHeader === '' ||
    signatureHeader === undefined ||
    signatureHeader === ''
  ) {
    return { ok: false, reason: 'missing' };
  }
  if (!/^-?\d+$/.test(timestampHeader)) return { ok: false, reason: 'missing' };

  const timestamp = Number(timestampHeader);
  const tolerance = options.toleranceSeconds ?? DEFAULT_TOLERANCE_SECONDS;
  if (Math.abs(Math.floor(now.getTime() / 1000) - timestamp) > tolerance) {
    return { ok: false, reason: 'stale' };
  }

  const expected = `sha256=${await hmacSha256Hex(secret, `${String(timestamp)}.${rawBody}`)}`;
  return constantTimeEqual(expected, signatureHeader)
    ? { ok: true }
    : { ok: false, reason: 'mismatch' };
}
