/**
 * Verify GitHub's webhook signature.
 *
 * GitHub signs each delivery with `HMAC-SHA256(secret, rawBody)` and sends it as
 * `X-Hub-Signature-256: sha256=<hex>`. We recompute it with Web Crypto (`crypto.subtle` — no
 * `nodejs_compat` needed) and compare CONSTANT-TIME so a wrong signature can't be brute-forced a
 * byte at a time. Reject mismatches with 401 so ticket state can't be forged.
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
  if (!signatureHeader?.startsWith('sha256=')) return false;

  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const signature = await crypto.subtle.sign('HMAC', key, encoder.encode(rawBody));
  const expected = `sha256=${toHex(signature)}`;

  return constantTimeEqual(expected, signatureHeader);
}
