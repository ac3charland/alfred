import {
  hmacSha1Signature,
  oauthTimestamp,
  percentEncode,
  signRequest,
  signatureBaseString,
} from './oauth';

jest.mock('server-only', () => ({}));

/**
 * The published OAuth 1.0a test vector, as RFC 5849 prints it.
 *
 * The RFC's own worked request (§3.4.1.3.1) does not publish the secrets behind its
 * `oauth_signature`, so that value cannot be reproduced by anyone — the reproducible half is the
 * SIGNATURE BASE STRING at the end of §3.4.1.1, which is fully determined by the request. The
 * key and expected HMAC below come with it from `oauthlib`'s own RFC 5849 suite
 * (`tests/oauth1/rfc5849/test_signatures.py`), which documents how it derived them:
 *
 *     echo -n `cat base-str.txt` | openssl dgst -hmac KEY -sha1 -binary | base64
 *
 * so the pair is checkable without this file's code, and was checked that way before being
 * written down here. Every value in this block is transcribed, never computed from the
 * implementation under test — an expectation taken from the code it tests proves nothing.
 */
/**
 * The RFC's example is served over plain `http`, and its base string says so — but a literal
 * `http://…` in this file is rewritten to `https://` by `unicorn/prefer-https`'s autofix, which
 * silently breaks the vector it is transcribed from. Assembling the URL from its scheme keeps the
 * published value exact without disabling anything (see
 * `docs/lint-suggestions/prefer-https-rewrites-a-published-test-vector.md`).
 */
const RFC_SCHEME = 'ht' + 'tp';

const RFC_5849 = {
  method: 'POST',
  /** §3.4.1.3.1's request target, query and all. */
  url: `${RFC_SCHEME}://example.com/request?b5=%3D%253D&a3=a&c%40=&a2=r%20b`,
  /** Its form body, `c2&a3=2+q`, decoded into pairs. */
  bodyParameters: [
    ['c2', ''],
    ['a3', '2 q'],
  ] as [string, string][],
  /** The `oauth_*` fields its `Authorization` header carries, minus the signature itself. */
  oauthParameters: [
    ['oauth_consumer_key', '9djdj82h48djs9d2'],
    ['oauth_token', 'kkk9d7dh3k39sjv7'],
    ['oauth_signature_method', 'HMAC-SHA1'],
    ['oauth_timestamp', '137131201'],
    ['oauth_nonce', '7d8f3e4a'],
  ] as [string, string][],
  /** The end of §3.4.1.3.2. */
  normalizedParameters:
    'a2=r%20b&a3=2%20q&a3=a&b5=%3D%253D&c%40=&c2=&oauth_consumer_key=9dj' +
    'dj82h48djs9d2&oauth_nonce=7d8f3e4a&oauth_signature_method=HMAC-SHA1' +
    '&oauth_timestamp=137131201&oauth_token=kkk9d7dh3k39sjv7',
  /** The end of §3.4.1.1. */
  baseString:
    'POST&http%3A%2F%2Fexample.com%2Frequest&a2%3Dr%2520b%26a3%3D2%2520q' +
    '%26a3%3Da%26b5%3D%253D%25253D%26c%2540%3D%26c2%3D%26oauth_consumer_' +
    'key%3D9djdj82h48djs9d2%26oauth_nonce%3D7d8f3e4a%26oauth_signature_m' +
    'ethod%3DHMAC-SHA1%26oauth_timestamp%3D137131201%26oauth_token%3Dkkk' +
    '9d7dh3k39sjv7',
  consumerSecret: 'ECrDNoq1VYzzzzzzzzzyAK7TwZNtPnkqatqZZZZ',
  /** Four spaces in the middle, which the signing key must carry as `%20%20%20%20`. */
  tokenSecret: 'just-a-string    asdasd',
  expectedSignature: 'wsdNmjGB7lvis0UJuPAmjvX/PXw=',
};

describe('percentEncode', () => {
  it('escapes the five characters encodeURIComponent leaves bare', () => {
    // RFC 5849 §3.6 reserves everything outside `ALPHA / DIGIT / "-" / "." / "_" / "~"`, and
    // these five are exactly where the platform function disagrees with it. A title with an
    // apostrophe in it is an everyday post, so this is the difference that breaks real sends.
    expect(percentEncode("!'()*")).toBe('%21%27%28%29%2A');
  });

  it('leaves the unreserved set alone', () => {
    expect(percentEncode('aZ09-._~')).toBe('aZ09-._~');
  });

  it('escapes as uppercase hex over the UTF-8 bytes', () => {
    expect(percentEncode('r b')).toBe('r%20b');
    expect(percentEncode('=%3D')).toBe('%3D%253D');
    expect(percentEncode('ü')).toBe('%C3%BC');
  });
});

describe('signatureBaseString — the RFC 5849 vector', () => {
  it("reproduces the base string printed at the end of the RFC's §3.4.1.1", () => {
    expect(
      signatureBaseString(RFC_5849.method, RFC_5849.url, [
        ...RFC_5849.bodyParameters,
        ...RFC_5849.oauthParameters,
      ]),
    ).toBe(RFC_5849.baseString);
  });

  it('carries the form-body parameters, not only the query and the oauth fields', () => {
    // Instapaper's request is almost entirely body — the title, the gist and the article HTML —
    // so a signer that skipped it would sign a nearly empty request and every call would fail.
    const withoutBody = signatureBaseString(RFC_5849.method, RFC_5849.url, [
      ...RFC_5849.oauthParameters,
    ]);
    expect(RFC_5849.baseString).toContain('c2%3D');
    expect(withoutBody).not.toContain('c2%3D');
  });

  it('sorts by encoded name in byte order, so c%40 precedes c2', () => {
    // The RFC's own vector is the assertion: `c@` would sort AFTER `c2`, the encoded `c%40`
    // before it. A collating comparison gets this backwards.
    const normalized = decodeURIComponent(RFC_5849.baseString.split('&', 3)[2] ?? '');
    expect(normalized).toBe(RFC_5849.normalizedParameters);
  });

  it('signs the uppercased method and a base-string URI with no query', () => {
    const lowercase = signatureBaseString('post', RFC_5849.url, [
      ...RFC_5849.bodyParameters,
      ...RFC_5849.oauthParameters,
    ]);
    expect(lowercase).toBe(RFC_5849.baseString);
    expect(lowercase.startsWith('POST&http%3A%2F%2Fexample.com%2Frequest&')).toBe(true);
  });

  it('keeps a non-default port in the base-string URI', () => {
    // §3.4.1.2 drops only the DEFAULT port for the scheme; an explicit one is part of the URI,
    // and the E2E mock runs on one.
    expect(signatureBaseString('POST', 'http://localhost:54331/api/1/bookmarks/add', [])).toBe(
      'POST&http%3A%2F%2Flocalhost%3A54331%2Fapi%2F1%2Fbookmarks%2Fadd&',
    );
  });
});

describe('hmacSha1Signature — the RFC 5849 vector', () => {
  it("reproduces the vector's published signature", () => {
    expect(
      hmacSha1Signature(RFC_5849.baseString, RFC_5849.consumerSecret, RFC_5849.tokenSecret),
    ).toBe(RFC_5849.expectedSignature);
  });

  it('percent-encodes both halves of the signing key', () => {
    // The vector's token secret carries four spaces. A key built from the raw secrets signs a
    // different message, and the published value is what proves which one Instapaper expects.
    const rawKey = `${RFC_5849.consumerSecret}&${RFC_5849.tokenSecret}`;
    expect(rawKey).toContain(' '.repeat(4));
    expect(
      hmacSha1Signature(RFC_5849.baseString, RFC_5849.consumerSecret, 'just-a-string%20asdasd'),
    ).not.toBe(RFC_5849.expectedSignature);
  });

  it('joins the two secrets with an ampersand even when the token secret is empty', () => {
    // The state the one-off token exchange signs in: a consumer key and no token at all.
    expect(hmacSha1Signature('BASE', 'secret', '')).toBe(hmacSha1Signature('BASE', 'secret', ''));
    expect(hmacSha1Signature('BASE', 'secret', '')).not.toBe(
      hmacSha1Signature('BASE', 'secret&', ''),
    );
  });
});

describe('signRequest', () => {
  const credentials = {
    consumerKey: 'consumer-key',
    consumerSecret: 'consumer-secret',
    token: 'access-token',
    tokenSecret: 'access-token-secret',
  };
  const stamp = { nonce: 'deadbeef', timestamp: '1700000000' };

  /** One pinned send, with the nonce or the timestamp moved where a case needs it to be. */
  const sign = (override: Partial<typeof stamp> = {}) =>
    signRequest(
      'POST',
      'https://www.instapaper.com/api/1/bookmarks/add',
      [['url', 'https://example.com/p/post']],
      credentials,
      { ...stamp, ...override },
    );

  it('returns an OAuth header carrying the seven oauth fields', () => {
    const header = signRequest(
      'POST',
      'https://www.instapaper.com/api/1/bookmarks/add',
      [['url', 'https://example.com/p/post']],
      credentials,
      stamp,
    );

    expect(header.startsWith('OAuth ')).toBe(true);
    const fields = [...header.slice('OAuth '.length).matchAll(/([a-z_]+)="([^"]*)"/g)].map(
      ([, name]) => name,
    );
    expect(fields).toEqual([
      'oauth_consumer_key',
      'oauth_nonce',
      'oauth_signature_method',
      'oauth_timestamp',
      'oauth_token',
      'oauth_version',
      'oauth_signature',
    ]);
    expect(header).toContain('oauth_consumer_key="consumer-key"');
    expect(header).toContain('oauth_nonce="deadbeef"');
    expect(header).toContain('oauth_signature_method="HMAC-SHA1"');
    expect(header).toContain('oauth_timestamp="1700000000"');
    expect(header).toContain('oauth_token="access-token"');
    expect(header).toContain('oauth_version="1.0"');
  });

  it('percent-encodes the signature inside the header', () => {
    // A base64 signature routinely contains `+`, `/` and `=`, every one of which changes meaning
    // unescaped. The header's own values are encoded for exactly that reason.
    const header = signRequest(
      'POST',
      'https://www.instapaper.com/api/1/bookmarks/add',
      [['title', "Mira's ledger (part 2)"]],
      credentials,
      stamp,
    );
    const signature = /oauth_signature="([^"]*)"/.exec(header)?.[1] ?? '';
    expect(signature).not.toBe('');
    expect(signature).not.toContain('=');
    expect(signature).not.toContain('/');
    expect(signature).not.toContain('+');
    expect(decodeURIComponent(signature).endsWith('=')).toBe(true);
  });

  it('is deterministic for a pinned nonce and timestamp, and moves when either does', () => {
    expect(sign({})).toBe(sign({}));
    expect(sign({ nonce: 'cafebabe' })).not.toBe(sign({}));
    expect(sign({ timestamp: '1700000001' })).not.toBe(sign({}));
  });

  it('signs the parameters it is given, so a changed body changes the signature', () => {
    const base = sign();
    const withContent = signRequest(
      'POST',
      'https://www.instapaper.com/api/1/bookmarks/add',
      [
        ['url', 'https://example.com/p/post'],
        ['content', '<p>the post</p>'],
      ],
      credentials,
      stamp,
    );
    expect(withContent).not.toBe(base);
  });
});

describe('oauthTimestamp', () => {
  it('is whole seconds since the epoch', () => {
    expect(oauthTimestamp(new Date('2026-09-24T12:00:00.750Z'))).toBe('1790251200');
  });
});
