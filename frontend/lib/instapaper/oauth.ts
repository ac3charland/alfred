import { createHmac, randomBytes } from 'node:crypto';

import 'server-only';

/**
 * OAuth 1.0a request signing, HMAC-SHA1, per RFC 5849 — the only scheme Instapaper's Full API
 * accepts. Hand-rolled rather than a dependency because it is about sixty lines, and the tests pin
 * it to the RFC's own worked examples: an HMAC can't be matched by a signer that is merely close.
 *
 * Shared by the send route (every `bookmarks/add`) and the one-off token script
 * (`scripts/instapaper-token.mjs`, the xAuth exchange), so there is one signer to get right. That
 * script loads this file with Node's own type stripping, which is why it imports nothing but Node
 * builtins and uses no TypeScript syntax that has to be compiled rather than erased.
 */

/** What a request is signed with. The token pair is absent only for the xAuth exchange itself. */
export interface OAuthCredentials {
  consumerKey: string;
  consumerSecret: string;
  token?: string | undefined;
  tokenSecret?: string | undefined;
}

/** The two values that make each signature unique. Injectable so a test's signature is fixed. */
export interface SigningMoment {
  nonce: string;
  /** Whole seconds since the epoch. */
  timestamp: number;
}

/**
 * RFC 5849 §3.6: every byte of the UTF-8 encoding escaped as `%XX` (upper-case hex) except the
 * unreserved `A-Z a-z 0-9 - . _ ~`. `encodeURIComponent` is that, apart from the five characters
 * it leaves bare that the RFC does not.
 */
export function percentEncode(value: string): string {
  return encodeURIComponent(value).replaceAll(
    /[!'()*]/g,
    (character) => `%${character.codePointAt(0)?.toString(16).toUpperCase() ?? ''}`,
  );
}

/** Byte-order comparison — the RFC sorts the encoded strings, never by locale. */
function compareEncoded(left: string, right: string): number {
  if (left < right) return -1;
  return left > right ? 1 : 0;
}

/**
 * RFC 5849 §3.4.1: the method, the base URL (scheme and host lower-cased, a default port dropped,
 * no query or fragment) and the normalized parameters, each percent-encoded and joined by `&`.
 *
 * `params` is everything signed besides the URL's own query: the form body's parameters and the
 * `oauth_*` protocol parameters (never `oauth_signature`, never `realm`). Pairs rather than a map,
 * because a name may repeat and each occurrence is signed. The query is read off `url` and decoded
 * the way a form is, so `+` is a space in both — which is how the server decodes them too.
 */
export function signatureBaseString(
  method: string,
  url: string,
  params: readonly (readonly [string, string])[],
): string {
  const parsed = new URL(url);
  const pairs = [...parsed.searchParams, ...params].map(
    ([name, value]) => [percentEncode(name), percentEncode(value)] as const,
  );
  // Sorted in place, on the fresh copy `map` just made: this module is also loaded by plain Node
  // (the token script), so it cannot reach the app's `@/lib/sort` helper.
  pairs.sort(([leftName, leftValue], [rightName, rightValue]) =>
    leftName === rightName
      ? compareEncoded(leftValue, rightValue)
      : compareEncoded(leftName, rightName),
  );
  const normalized = pairs.map(([name, value]) => `${name}=${value}`).join('&');
  // `URL` already lower-cases the scheme and host and drops a port that is the scheme's default.
  const baseUrl = `${parsed.protocol}//${parsed.host}${parsed.pathname}`;
  return [method.toUpperCase(), percentEncode(baseUrl), percentEncode(normalized)].join('&');
}

/**
 * RFC 5849 §3.4.2: HMAC-SHA1 over the base string, keyed by the encoded consumer secret and token
 * secret joined by `&` — the `&` stays even when there is no token secret yet. Base64, unencoded.
 */
export function hmacSha1Signature(
  baseString: string,
  consumerSecret: string,
  tokenSecret = '',
): string {
  const key = `${percentEncode(consumerSecret)}&${percentEncode(tokenSecret)}`;
  return createHmac('sha1', key).update(baseString).digest('base64');
}

/** A fresh nonce and the current second, for a real request. */
export function newSigningMoment(): SigningMoment {
  return { nonce: randomBytes(16).toString('hex'), timestamp: Math.floor(Date.now() / 1000) };
}

/**
 * The `Authorization` header for one request: `OAuth ` and the protocol parameters — consumer key,
 * nonce, signature, signature method, timestamp, token (when there is one) and version — sorted
 * and percent-encoded. `params` is the form body, sent as-is and signed here, so the two cannot
 * disagree about what was sent.
 *
 * The header is a credential in all but name: it is never logged.
 */
export function signRequest(
  method: string,
  url: string,
  params: Readonly<Record<string, string>>,
  credentials: OAuthCredentials,
  moment: SigningMoment = newSigningMoment(),
): string {
  const protocol: [string, string][] = [
    ['oauth_consumer_key', credentials.consumerKey],
    ['oauth_nonce', moment.nonce],
    ['oauth_signature_method', 'HMAC-SHA1'],
    ['oauth_timestamp', String(moment.timestamp)],
    ['oauth_version', '1.0'],
  ];
  if (credentials.token !== undefined) protocol.push(['oauth_token', credentials.token]);

  const signature = hmacSha1Signature(
    signatureBaseString(method, url, [...Object.entries(params), ...protocol]),
    credentials.consumerSecret,
    credentials.tokenSecret,
  );

  const fields: [string, string][] = [...protocol, ['oauth_signature', signature]];
  fields.sort(([left], [right]) => compareEncoded(left, right));
  return `OAuth ${fields.map(([name, value]) => `${percentEncode(name)}="${percentEncode(value)}"`).join(', ')}`;
}
