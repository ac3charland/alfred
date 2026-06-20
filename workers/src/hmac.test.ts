import { verifySignature } from './hmac';

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
