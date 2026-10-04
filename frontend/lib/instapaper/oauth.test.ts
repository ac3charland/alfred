/** @jest-environment node */
import { createHmac } from 'node:crypto';

import {
  type OAuthCredentials,
  freshStamp,
  normalizedParameters,
  percentEncode,
  signRequest,
  signatureBaseString,
} from './oauth';

jest.mock('server-only', () => ({}));

/**
 * Pull the `key="value"` fields back out of an Authorization header, undoing nothing — the
 * values stay percent-encoded exactly as they travel on the wire.
 */
function headerFields(header: string): Record<string, string> {
  const fields: Record<string, string> = {};
  for (const [, name, value] of header.matchAll(/(\w+)="([^"]*)"/g)) {
    if (name !== undefined && value !== undefined) fields[name] = value;
  }
  return fields;
}

/** Sign independently of the code under test, from a base string and the two raw secrets. */
function hmacSha1(baseString: string, consumerSecret: string, tokenSecret: string): string {
  return createHmac('sha1', `${percentEncode(consumerSecret)}&${percentEncode(tokenSecret)}`)
    .update(baseString)
    .digest('base64');
}

describe('percentEncode', () => {
  it('leaves the unreserved set untouched', () => {
    expect(percentEncode('AZaz09-._~')).toBe('AZaz09-._~');
  });

  it('encodes a space as %20, never as +', () => {
    expect(percentEncode('a b+c')).toBe('a%20b%2Bc');
  });

  it("escapes the characters encodeURIComponent leaves alone: ! * ' ( )", () => {
    expect(percentEncode("!*'()")).toBe('%21%2A%27%28%29');
  });

  it('encodes reserved characters with uppercase hex digits', () => {
    expect(percentEncode('/?#[]@:&=$,;')).toBe('%2F%3F%23%5B%5D%40%3A%26%3D%24%2C%3B');
  });

  it('encodes non-ASCII text as UTF-8 octets', () => {
    expect(percentEncode('café ☕')).toBe('caf%C3%A9%20%E2%98%95');
  });

  it('encodes the empty string as the empty string', () => {
    expect(percentEncode('')).toBe('');
  });
});

describe('RFC 5849 signature base string worked example', () => {
  // The request RFC 5849 section 3.4.1.1 walks through:
  //   POST /request?b5=%3D%253D&a3=a&c%40=&a2=r%20b HTTP/1.1
  //   Host: example.com
  //   Content-Type: application/x-www-form-urlencoded
  //   Authorization: OAuth realm="Example", oauth_consumer_key="9djdj82h48djs9d2",
  //     oauth_token="kkk9d7dh3k39sjv7", oauth_signature_method="HMAC-SHA1",
  //     oauth_timestamp="137131201", oauth_nonce="7d8f3e4a", oauth_signature="..."
  //
  //   c2&a3=2+q
  //
  // The body decodes to `c2` (empty value) and `a3` = "2 q"; the query contributes the other
  // three. `a3` appears in both, which is the case that forces sorting by value as well as name.
  // Plain HTTP, as the RFC prints it — the published base string below spells it `http%3A%2F%2F`.
  // The scheme is a variable only so the lint autofix that upgrades literal `http://` URLs
  // doesn't silently turn a fixture meant to match the RFC into one that cannot.
  const SCHEME = 'http';
  const URL_WITH_QUERY = `${SCHEME}://example.com/request?b5=%3D%253D&a3=a&c%40=&a2=r%20b`;
  const PARAMS = {
    c2: '',
    a3: '2 q',
    oauth_consumer_key: '9djdj82h48djs9d2',
    oauth_nonce: '7d8f3e4a',
    oauth_signature_method: 'HMAC-SHA1',
    oauth_timestamp: '137131201',
    oauth_token: 'kkk9d7dh3k39sjv7',
  };

  // The normalized parameter string the RFC prints in section 3.4.1.3.2.
  const NORMALIZED =
    'a2=r%20b&a3=2%20q&a3=a&b5=%3D%253D&c%40=&c2=&oauth_consumer_key=9djdj82h48djs9d2' +
    '&oauth_nonce=7d8f3e4a&oauth_signature_method=HMAC-SHA1&oauth_timestamp=137131201' +
    '&oauth_token=kkk9d7dh3k39sjv7';

  // The signature base string the RFC prints in section 3.4.1.1, unwrapped.
  const BASE_STRING =
    'POST&http%3A%2F%2Fexample.com%2Frequest&a2%3Dr%2520b%26a3%3D2%2520q' +
    '%26a3%3Da%26b5%3D%253D%25253D%26c%2540%3D%26c2%3D%26oauth_consumer_key%3D9djdj82h48djs9d2' +
    '%26oauth_nonce%3D7d8f3e4a%26oauth_signature_method%3DHMAC-SHA1%26oauth_timestamp%3D137131201' +
    '%26oauth_token%3Dkkk9d7dh3k39sjv7';

  it('normalizes the query and body parameters into the RFC string', () => {
    expect(normalizedParameters(URL_WITH_QUERY, PARAMS)).toBe(NORMALIZED);
  });

  it('builds the RFC base string', () => {
    expect(signatureBaseString('POST', URL_WITH_QUERY, PARAMS)).toBe(BASE_STRING);
  });

  it('uppercases the method', () => {
    expect(signatureBaseString('post', URL_WITH_QUERY, PARAMS)).toBe(BASE_STRING);
  });
});

describe('signRequest against a published signature', () => {
  // Twitter's "Creating a signature" worked example for OAuth 1.0a HMAC-SHA1, whose published
  // signature is `hCtSmYh+iHYCEqBWrE7C7hYmtUk=`. Chosen over the RFC's own request because the
  // RFC's printed signature for that request is known not to match its printed inputs (RFC 5849
  // errata); here every input and the signature are mutually consistent. The example carries a
  // query parameter AND a form-body parameter, so it exercises both halves of the base string.
  const URL = 'https://api.twitter.com/1.1/statuses/update.json?include_entities=true';
  const BODY = { status: 'Hello Ladies + Gentlemen, a signed OAuth request!' };
  const CREDENTIALS: OAuthCredentials = {
    consumerKey: 'xvz1evFS4wEEPTGEFPHBog',
    consumerSecret: 'kAcSOqF21Fu85e7zjz7ZN2U4ZRhfV3WpwPAoE3Z7kBw',
    token: '370773112-GmHxMAgYyLbNEtIKZeRNFsMKPR9EyMZeS9weJAEb',
    tokenSecret: 'LswwdoUaIvS8ltyTt5jkRh4J50vUPVVHtR2YPi5kE',
  };
  const STAMP = { nonce: 'kYjzVBB8Y0ZFabxSWbWovY3uYSQ2pTgmZeNu2VS4cg', timestamp: '1318622958' };

  it('reproduces the published signature, percent-encoded inside the header', () => {
    const header = signRequest('POST', URL, BODY, CREDENTIALS, STAMP);

    // `+` and `=` in the base64 signature travel as %2B and %3D.
    expect(headerFields(header)['oauth_signature']).toBe('hCtSmYh%2BiHYCEqBWrE7C7hYmtUk%3D');
  });

  it('assembles exactly the published fields, alphabetically, in one header', () => {
    expect(signRequest('POST', URL, BODY, CREDENTIALS, STAMP)).toBe(
      'OAuth ' +
        'oauth_consumer_key="xvz1evFS4wEEPTGEFPHBog", ' +
        'oauth_nonce="kYjzVBB8Y0ZFabxSWbWovY3uYSQ2pTgmZeNu2VS4cg", ' +
        'oauth_signature="hCtSmYh%2BiHYCEqBWrE7C7hYmtUk%3D", ' +
        'oauth_signature_method="HMAC-SHA1", ' +
        'oauth_timestamp="1318622958", ' +
        'oauth_token="370773112-GmHxMAgYyLbNEtIKZeRNFsMKPR9EyMZeS9weJAEb", ' +
        'oauth_version="1.0"',
    );
  });

  it('puts the form-body parameters in the signature, so changing one changes it', () => {
    const original = headerFields(signRequest('POST', URL, BODY, CREDENTIALS, STAMP));
    const changed = headerFields(
      signRequest(
        'POST',
        URL,
        { status: 'Hello Ladies, a different request!' },
        CREDENTIALS,
        STAMP,
      ),
    );

    expect(changed['oauth_signature']).not.toBe(original['oauth_signature']);
  });

  it('puts the query parameters in the signature too', () => {
    const original = headerFields(signRequest('POST', URL, BODY, CREDENTIALS, STAMP));
    const changed = headerFields(
      signRequest(
        'POST',
        'https://api.twitter.com/1.1/statuses/update.json?include_entities=false',
        BODY,
        CREDENTIALS,
        STAMP,
      ),
    );

    expect(changed['oauth_signature']).not.toBe(original['oauth_signature']);
  });

  it('signs with the secrets: a different token secret yields a different signature', () => {
    const original = headerFields(signRequest('POST', URL, BODY, CREDENTIALS, STAMP));
    const changed = headerFields(
      signRequest('POST', URL, BODY, { ...CREDENTIALS, tokenSecret: 'another-secret' }, STAMP),
    );

    expect(changed['oauth_signature']).not.toBe(original['oauth_signature']);
  });
});

describe('signRequest header shape', () => {
  const CREDENTIALS: OAuthCredentials = {
    consumerKey: 'consumer key/with+odd=chars',
    consumerSecret: 'consumer&secret',
    token: 'token~value!',
    tokenSecret: 'token secret',
  };
  const STAMP = { nonce: 'a+b/c=d', timestamp: '1700000000' };

  it('starts with the OAuth scheme and carries exactly the seven oauth fields', () => {
    const header = signRequest(
      'POST',
      'https://www.instapaper.com/api/1/bookmarks/add',
      { url: 'https://example.com/post' },
      CREDENTIALS,
      STAMP,
    );

    expect(header.startsWith('OAuth ')).toBe(true);
    expect(Object.keys(headerFields(header))).toStrictEqual([
      'oauth_consumer_key',
      'oauth_nonce',
      'oauth_signature',
      'oauth_signature_method',
      'oauth_timestamp',
      'oauth_token',
      'oauth_version',
    ]);
  });

  it('percent-encodes every value and never carries the form-body params', () => {
    const header = signRequest(
      'POST',
      'https://www.instapaper.com/api/1/bookmarks/add',
      { url: 'https://example.com/post', title: 'A title' },
      CREDENTIALS,
      STAMP,
    );
    const fields = headerFields(header);

    expect(fields['oauth_consumer_key']).toBe('consumer%20key%2Fwith%2Bodd%3Dchars');
    expect(fields['oauth_nonce']).toBe('a%2Bb%2Fc%3Dd');
    expect(fields['oauth_token']).toBe('token~value%21');
    expect(fields['oauth_timestamp']).toBe('1700000000');
    expect(fields['oauth_signature_method']).toBe('HMAC-SHA1');
    expect(fields['oauth_version']).toBe('1.0');
    expect(header).not.toContain('title');
    expect(header).not.toContain('example.com');
  });

  it('signs the base string with the consumer secret and the token secret', () => {
    const url = 'https://www.instapaper.com/api/1/bookmarks/add';
    const params = { url: 'https://example.com/post', title: 'A title' };
    const header = signRequest('POST', url, params, CREDENTIALS, STAMP);

    const baseString = signatureBaseString('POST', url, {
      ...params,
      oauth_consumer_key: CREDENTIALS.consumerKey,
      oauth_nonce: STAMP.nonce,
      oauth_signature_method: 'HMAC-SHA1',
      oauth_timestamp: STAMP.timestamp,
      oauth_token: 'token~value!',
      oauth_version: '1.0',
    });
    const expected = hmacSha1(baseString, 'consumer&secret', 'token secret');

    expect(headerFields(header)['oauth_signature']).toBe(percentEncode(expected));
  });

  it('omits oauth_token when the credentials carry no token, as in the one-off token exchange', () => {
    const url = 'https://www.instapaper.com/api/1/oauth/access_token';
    const params = { x_auth_username: 'me@example.com', x_auth_mode: 'client_auth' };
    const header = signRequest(
      'POST',
      url,
      params,
      { consumerKey: 'ck', consumerSecret: 'cs' },
      STAMP,
    );
    const fields = headerFields(header);

    expect(Object.keys(fields)).toStrictEqual([
      'oauth_consumer_key',
      'oauth_nonce',
      'oauth_signature',
      'oauth_signature_method',
      'oauth_timestamp',
      'oauth_version',
    ]);
    expect(header).not.toContain('oauth_token');

    // No token secret either: the key is the consumer secret followed by an empty second half.
    const baseString = signatureBaseString('POST', url, {
      ...params,
      oauth_consumer_key: 'ck',
      oauth_nonce: STAMP.nonce,
      oauth_signature_method: 'HMAC-SHA1',
      oauth_timestamp: STAMP.timestamp,
      oauth_version: '1.0',
    });
    expect(fields['oauth_signature']).toBe(percentEncode(hmacSha1(baseString, 'cs', '')));
  });

  it('treats a token with no secret as an empty secret', () => {
    const url = 'https://www.instapaper.com/api/1/bookmarks/add';
    const header = signRequest(
      'POST',
      url,
      {},
      { consumerKey: 'ck', consumerSecret: 'cs', token: 'tk' },
      STAMP,
    );

    expect(headerFields(header)['oauth_token']).toBe('tk');
  });
});

describe('signatureBaseString', () => {
  it('lowercases the scheme and host, keeps the path case, and drops a default port', () => {
    expect(signatureBaseString('POST', 'HTTP://EXAMPLE.com:80/Request', {})).toBe(
      'POST&http%3A%2F%2Fexample.com%2FRequest&',
    );
    expect(signatureBaseString('POST', 'https://Example.com:443/a/b', {})).toBe(
      'POST&https%3A%2F%2Fexample.com%2Fa%2Fb&',
    );
  });

  it('keeps a non-default port', () => {
    expect(signatureBaseString('POST', 'http://127.0.0.1:4010/api/1/bookmarks/add', {})).toBe(
      'POST&http%3A%2F%2F127.0.0.1%3A4010%2Fapi%2F1%2Fbookmarks%2Fadd&',
    );
  });

  it('moves the query string out of the base string URI and into the parameters', () => {
    expect(signatureBaseString('GET', 'https://example.com/a?x=1', {})).toBe(
      'GET&https%3A%2F%2Fexample.com%2Fa&x%3D1',
    );
  });

  it('uses "/" as the path of a bare origin', () => {
    expect(signatureBaseString('POST', 'https://example.com', {})).toBe(
      'POST&https%3A%2F%2Fexample.com%2F&',
    );
  });
});

describe('normalizedParameters', () => {
  it('sorts by encoded name, then by encoded value', () => {
    expect(normalizedParameters('https://example.com/?a=2&a=1&b=1', { a: '10', c: '0' })).toBe(
      'a=1&a=10&a=2&b=1&c=0',
    );
  });

  it('encodes names and values before sorting and joining', () => {
    expect(normalizedParameters('https://example.com/', { 'a b': 'x&y=z', 'a-b': '1' })).toBe(
      'a%20b=x%26y%3Dz&a-b=1',
    );
  });

  it('reads a + in the query as a space, as form decoding does', () => {
    expect(normalizedParameters('https://example.com/?q=a+b', {})).toBe('q=a%20b');
  });

  it('is just the encoded body when the URL has no query', () => {
    expect(normalizedParameters('https://example.com/', { title: 'Hello, world' })).toBe(
      'title=Hello%2C%20world',
    );
  });
});

describe('freshStamp', () => {
  it('stamps whole seconds since the epoch', () => {
    const { timestamp } = freshStamp();

    expect(timestamp).toMatch(/^\d+$/);
    expect(Math.abs(Number(timestamp) - Date.now() / 1000)).toBeLessThan(5);
  });

  it('draws a long random nonce, different every time', () => {
    const first = freshStamp().nonce;
    const second = freshStamp().nonce;

    expect(first).toMatch(/^[0-9a-f]{32}$/);
    expect(second).not.toBe(first);
  });
});
