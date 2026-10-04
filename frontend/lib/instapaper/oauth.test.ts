/** @jest-environment node */
import {
  type OAuthParameter,
  hmacSha1Signature,
  percentEncode,
  signRequest,
  signatureBaseString,
} from './oauth';

jest.mock('server-only', () => ({}));

/**
 * RFC 5849 §3.4.1's worked example: a POST whose parameters come from the URL's query, the
 * `oauth_*` set and the form body (`c2&a3=2+q`). The base string below is copied from the end of
 * §3.4.1.1 — as reproduced, with the RFC's parameter table from §3.4.1.3.1, in oauthlib's
 * `tests/oauth1/rfc5849/test_signatures.py`.
 */
// The RFC's request is plain `http:` — the scheme is part of what is signed — so the literal is
// assembled from parts: `unicorn/prefer-https` would otherwise rewrite it and break the vector.
const RFC_URL = ['http', '//example.com/request?b5=%3D%253D&a3=a&c%40=&a2=r%20b'].join(':');
const RFC_PARAMETERS: OAuthParameter[] = [
  ['oauth_consumer_key', '9djdj82h48djs9d2'],
  ['oauth_token', 'kkk9d7dh3k39sjv7'],
  ['oauth_signature_method', 'HMAC-SHA1'],
  ['oauth_timestamp', '137131201'],
  ['oauth_nonce', '7d8f3e4a'],
  // The form body, `c2&a3=2+q`, decoded.
  ['c2', ''],
  ['a3', '2 q'],
];
const RFC_BASE_STRING =
  'POST&http%3A%2F%2Fexample.com%2Frequest&a2%3Dr%2520b%26a3%3D2%2520q' +
  '%26a3%3Da%26b5%3D%253D%25253D%26c%2540%3D%26c2%3D%26oauth_consumer_' +
  'key%3D9djdj82h48djs9d2%26oauth_nonce%3D7d8f3e4a%26oauth_signature_m' +
  'ethod%3DHMAC-SHA1%26oauth_timestamp%3D137131201%26oauth_token%3Dkkk' +
  '9d7dh3k39sjv7';

/**
 * The RFC's own header example carries a placeholder signature, so the published HMAC-SHA1
 * value for that base string is oauthlib's (computed with `openssl dgst -hmac`), under these two
 * secrets — the spaces in the token secret exercise the key's own percent-encoding.
 */
const PUBLISHED_CONSUMER_SECRET = 'ECrDNoq1VYzzzzzzzzzyAK7TwZNtPnkqatqZZZZ';
const PUBLISHED_TOKEN_SECRET = 'just-a-string    asdasd';
const PUBLISHED_SIGNATURE = 'wsdNmjGB7lvis0UJuPAmjvX/PXw=';

describe('signatureBaseString', () => {
  it('reproduces RFC 5849’s worked example, form-body parameters included', () => {
    expect(signatureBaseString('POST', RFC_URL, RFC_PARAMETERS)).toBe(RFC_BASE_STRING);
  });

  it('lowercases the host and drops a default port', () => {
    expect(signatureBaseString('get', 'HTTPS://WWW.Example.com:443/api', [])).toBe(
      'GET&https%3A%2F%2Fwww.example.com%2Fapi&',
    );
  });
});

describe('hmacSha1Signature', () => {
  it('reproduces the published HMAC-SHA1 signature for the RFC base string', () => {
    expect(
      hmacSha1Signature(RFC_BASE_STRING, PUBLISHED_CONSUMER_SECRET, PUBLISHED_TOKEN_SECRET),
    ).toBe(PUBLISHED_SIGNATURE);
  });
});

describe('percentEncode', () => {
  it('encodes everything outside the unreserved set, in uppercase hex', () => {
    expect(percentEncode("a-._~ !*'()é")).toBe('a-._~%20%21%2A%27%28%29%C3%A9');
  });
});

describe('signRequest', () => {
  const CREDENTIALS = {
    consumerKey: 'ck',
    consumerSecret: 'cs',
    token: 'tok',
    tokenSecret: 'ts',
  };
  const URL = 'https://www.instapaper.com/api/1/bookmarks/add';
  const FIXED = { nonce: 'n0nce', timestamp: 1_790_000_000 };

  it('emits an OAuth header with the seven oauth_* fields, percent-encoded', () => {
    const header = signRequest('POST', URL, [['title', 'A post']], CREDENTIALS, FIXED);

    expect(header.startsWith('OAuth ')).toBe(true);
    const fields = header
      .slice('OAuth '.length)
      .split(', ')
      .map((field) => field.split('=', 1)[0]);
    expect(fields).toStrictEqual([
      'oauth_consumer_key',
      'oauth_nonce',
      'oauth_signature',
      'oauth_signature_method',
      'oauth_timestamp',
      'oauth_token',
      'oauth_version',
    ]);
    expect(header).toContain('oauth_nonce="n0nce"');
    expect(header).toContain('oauth_timestamp="1790000000"');
    expect(header).toContain('oauth_version="1.0"');
  });

  it('signs the base string built from the oauth set plus the form body', () => {
    const header = signRequest('POST', URL, [['title', 'A post']], CREDENTIALS, FIXED);

    const expected = hmacSha1Signature(
      signatureBaseString('POST', URL, [
        ['oauth_consumer_key', 'ck'],
        ['oauth_nonce', 'n0nce'],
        ['oauth_signature_method', 'HMAC-SHA1'],
        ['oauth_timestamp', '1790000000'],
        ['oauth_token', 'tok'],
        ['oauth_version', '1.0'],
        ['title', 'A post'],
      ]),
      'cs',
      'ts',
    );
    expect(header).toContain(`oauth_signature="${percentEncode(expected)}"`);
  });

  it('is deterministic under a fixed nonce and timestamp, and moves with the body', () => {
    const one = signRequest('POST', URL, [['title', 'A']], CREDENTIALS, FIXED);
    expect(signRequest('POST', URL, [['title', 'A']], CREDENTIALS, FIXED)).toBe(one);
    expect(signRequest('POST', URL, [['title', 'B']], CREDENTIALS, FIXED)).not.toBe(one);
  });

  it('omits oauth_token for the xAuth exchange, which has none yet', () => {
    const header = signRequest('POST', URL, [], { consumerKey: 'ck', consumerSecret: 'cs' }, FIXED);
    expect(header).not.toContain('oauth_token');
  });

  it('draws a fresh nonce when none is given', () => {
    const a = signRequest('POST', URL, [], CREDENTIALS);
    const b = signRequest('POST', URL, [], CREDENTIALS);
    expect(a).not.toBe(b);
  });
});
