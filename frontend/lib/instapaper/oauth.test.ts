/** @jest-environment @stryker-mutator/jest-runner/jest-env/node */
import {
  hmacSha1Signature,
  newSigningMoment,
  percentEncode,
  signRequest,
  signatureBaseString,
} from './oauth';

jest.mock('server-only', () => ({}));

/**
 * The vectors below are RFC 5849's own worked examples (§3.4.1.1 for the base string, §1.2 for
 * the signatures). An HMAC can't be matched by a signer that is merely close, so reproducing the
 * published values exactly is what proves this one follows the spec rather than a guess at it.
 */

/**
 * The RFC's examples are plain-HTTP URLs, and the scheme is part of the signed base string, so
 * the vectors only hold with `http:`. Spelled apart from the host because the lint pass rewrites
 * any literal `http://` URL to `https://` (`unicorn/prefer-https`), which would silently change
 * the vector — see docs/lint-suggestions/unicorn-prefer-https-vs-rfc-test-vectors.md.
 */
const HTTP = 'http:';

/** The client credentials every §1.2 example is signed with. */
const PRINTER = { consumerKey: 'dpf43f3p2l4k3l03', consumerSecret: 'kd94hf93k423kf44' };

describe('percentEncode', () => {
  it('leaves only the unreserved characters bare, and upper-cases the escapes', () => {
    expect(percentEncode('AZaz09-._~')).toBe('AZaz09-._~');
    // `encodeURIComponent` leaves these five alone; the RFC does not.
    expect(percentEncode("!'()*")).toBe('%21%27%28%29%2A');
    expect(percentEncode('a b+c/d=e&f')).toBe('a%20b%2Bc%2Fd%3De%26f');
  });

  it('encodes the UTF-8 bytes of a non-ASCII character', () => {
    expect(percentEncode('é — ✓')).toBe('%C3%A9%20%E2%80%94%20%E2%9C%93');
  });
});

describe('signatureBaseString', () => {
  it('reproduces the RFC 5849 §3.4.1.1 example, form-body parameters included', () => {
    // The request: POST /request?b5=%3D%253D&a3=a&c%40=&a2=r%20b with the body `c2&a3=2+q`, a
    // realm (never part of the base string) and five oauth_* parameters. The body's `a3` sorts in
    // beside the query's, which is the proof that form-body parameters are signed at all.
    const base = signatureBaseString(
      'POST',
      `${HTTP}//example.com/request?b5=%3D%253D&a3=a&c%40=&a2=r%20b`,
      [
        ['c2', ''],
        ['a3', '2 q'],
        ['oauth_consumer_key', '9djdj82h48djs9d2'],
        ['oauth_token', 'kkk9d7dh3k39sjv7'],
        ['oauth_signature_method', 'HMAC-SHA1'],
        ['oauth_timestamp', '137131201'],
        ['oauth_nonce', '7d8f3e4a'],
      ],
    );

    expect(base).toBe(
      'POST&http%3A%2F%2Fexample.com%2Frequest&a2%3Dr%2520b%26a3%3D2%2520q%26a3%3Da%26b5%3D' +
        '%253D%25253D%26c%2540%3D%26c2%3D%26oauth_consumer_key%3D9djdj82h48djs9d2%26oauth_nonce' +
        '%3D7d8f3e4a%26oauth_signature_method%3DHMAC-SHA1%26oauth_timestamp%3D137131201%26' +
        'oauth_token%3Dkkk9d7dh3k39sjv7',
    );
  });

  it('lower-cases the host, drops a default port and never carries the query into the base URL', () => {
    expect(
      signatureBaseString('post', 'HTTPS://WWW.Instapaper.com:443/api/1/bookmarks/add', []),
    ).toBe('POST&https%3A%2F%2Fwww.instapaper.com%2Fapi%2F1%2Fbookmarks%2Fadd&');
  });
});

describe('hmacSha1Signature', () => {
  it('reproduces the RFC 5849 §1.2 protected-resource signature', () => {
    const base = signatureBaseString(
      'GET',
      `${HTTP}//photos.example.net/photos?file=vacation.jpg&size=original`,
      [
        ['oauth_consumer_key', PRINTER.consumerKey],
        ['oauth_token', 'nnch734d00sl2jdk'],
        ['oauth_signature_method', 'HMAC-SHA1'],
        ['oauth_timestamp', '137131202'],
        ['oauth_nonce', 'chapoH'],
      ],
    );

    expect(hmacSha1Signature(base, PRINTER.consumerSecret, 'pfkkdhi9sl3r4s00')).toBe(
      'MdpQcU8iPSUjWoN/UDMsK2sui9I=',
    );
  });

  it('reproduces the RFC 5849 §1.2 temporary-credentials signature, keyed with no token secret', () => {
    // The request made before any token exists — the same shape as Instapaper's xAuth exchange.
    const base = signatureBaseString('POST', 'https://photos.example.net/initiate', [
      ['oauth_consumer_key', PRINTER.consumerKey],
      ['oauth_signature_method', 'HMAC-SHA1'],
      ['oauth_timestamp', '137131200'],
      ['oauth_nonce', 'wIjqoS'],
      ['oauth_callback', `${HTTP}//printer.example.com/ready`],
    ]);

    expect(hmacSha1Signature(base, PRINTER.consumerSecret)).toBe('74KNZJeDHnMBp0EMJ9ZHt/XKycU=');
  });
});

/** An Authorization header's `key="value"` pairs, in the order written. */
function fields(header: string): [string, string][] {
  expect(header.startsWith('OAuth ')).toBe(true);
  return header
    .slice('OAuth '.length)
    .split(', ')
    .map((pair) => {
      const match = /^([^=]+)="([^"]*)"$/.exec(pair);
      if (match === null) throw new Error(`not a header field: ${pair}`);
      return [match[1] ?? '', match[2] ?? ''];
    });
}

describe('signRequest', () => {
  const CREDENTIALS = {
    consumerKey: 'ck',
    consumerSecret: 'cs',
    token: 'tk',
    tokenSecret: 'ts',
  };
  const MOMENT = { nonce: 'n0nce', timestamp: 1_789_000_000 };
  const URL_ = 'https://www.instapaper.com/api/1/bookmarks/add';

  it('writes the seven oauth_* fields, sorted and percent-encoded', () => {
    const header = signRequest('POST', URL_, { title: 'A post' }, CREDENTIALS, MOMENT);

    expect(fields(header).map(([key]) => key)).toEqual([
      'oauth_consumer_key',
      'oauth_nonce',
      'oauth_signature',
      'oauth_signature_method',
      'oauth_timestamp',
      'oauth_token',
      'oauth_version',
    ]);
    expect(Object.fromEntries(fields(header))).toMatchObject({
      oauth_consumer_key: 'ck',
      oauth_nonce: 'n0nce',
      oauth_signature_method: 'HMAC-SHA1',
      oauth_timestamp: '1789000000',
      oauth_token: 'tk',
      oauth_version: '1.0',
    });
  });

  it('signs the form body: the signature is the HMAC of the base string that includes it', () => {
    const params = { url: 'https://example.com/p/a?b=c', title: 'Ünïcode & more' };
    const header = signRequest('POST', URL_, params, CREDENTIALS, MOMENT);

    const expected = hmacSha1Signature(
      signatureBaseString('POST', URL_, [
        ...Object.entries(params),
        ['oauth_consumer_key', 'ck'],
        ['oauth_nonce', 'n0nce'],
        ['oauth_signature_method', 'HMAC-SHA1'],
        ['oauth_timestamp', '1789000000'],
        ['oauth_token', 'tk'],
        ['oauth_version', '1.0'],
      ]),
      'cs',
      'ts',
    );
    const signature = Object.fromEntries(fields(header))['oauth_signature'];
    // The header carries the signature percent-encoded — base64's `+`, `/` and `=` escaped.
    expect(signature).toBe(percentEncode(expected));
    expect(signature).not.toMatch(/[+/=]/);
    // And a different body is a different signature: the body is really in there.
    const other = signRequest('POST', URL_, { ...params, title: 'Another' }, CREDENTIALS, MOMENT);
    expect(Object.fromEntries(fields(other))['oauth_signature']).not.toBe(signature);
  });

  it('leaves oauth_token out entirely when there is no token yet', () => {
    const header = signRequest(
      'POST',
      'https://www.instapaper.com/api/1/oauth/access_token',
      { x_auth_mode: 'client_auth' },
      { consumerKey: 'ck', consumerSecret: 'cs' },
      MOMENT,
    );
    expect(fields(header).map(([key]) => key)).not.toContain('oauth_token');
  });
});

describe('newSigningMoment', () => {
  it('draws a fresh nonce each time and stamps the current second', () => {
    const before = Math.floor(Date.now() / 1000);
    const first = newSigningMoment();
    const second = newSigningMoment();

    expect(first.nonce).toMatch(/^[\da-f]{32}$/);
    expect(second.nonce).not.toBe(first.nonce);
    expect(first.timestamp).toBeGreaterThanOrEqual(before);
    expect(first.timestamp).toBeLessThanOrEqual(Math.floor(Date.now() / 1000));
  });
});
