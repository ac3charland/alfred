import { createHmac, randomBytes } from 'node:crypto';

import 'server-only';

import { stableSorted } from '@/lib/sort';

/**
 * OAuth 1.0a request signing, HMAC-SHA1, per RFC 5849 — what Instapaper's Full API requires on
 * every call. Written out rather than pulled in as a dependency because it is forty lines and one
 * signature method, and the bundled token script (`scripts/instapaper-token.ts`) reuses it rather
 * than keeping a second signer.
 */

/** Who is signing. The token pair is absent only for the xAuth exchange that issues it. */
export interface OAuthCredentials {
  consumerKey: string;
  consumerSecret: string;
  token?: string | undefined;
  tokenSecret?: string | undefined;
}

/** Injectable so a signature is deterministic under test; both default to fresh values. */
export interface OAuthNonceAndTimestamp {
  nonce?: string | undefined;
  /** Seconds since the epoch, as the protocol wants it. */
  timestamp?: number | undefined;
}

/** A request parameter, as a pair: a name may repeat (RFC 5849 §3.4.1.3.1's own example does). */
export type OAuthParameter = readonly [name: string, value: string];

/**
 * RFC 5849 §3.6 percent-encoding: every byte of the UTF-8 encoding except the unreserved set
 * (`A-Z a-z 0-9 - . _ ~`), with uppercase hex. `encodeURIComponent` is that, minus the five
 * characters it leaves alone that the RFC does not.
 */
export function percentEncode(value: string): string {
  return encodeURIComponent(value).replaceAll(
    /[!'()*]/g,
    (character) => `%${(character.codePointAt(0) ?? 0).toString(16).toUpperCase()}`,
  );
}

/**
 * The signature base string (RFC 5849 §3.4.1): the method, the base string URI (scheme and host
 * lowercased, default port dropped, no query), and every parameter — the URL's query, the
 * `oauth_*` set and the form body alike — encoded, sorted by name then value, and joined.
 */
export function signatureBaseString(
  method: string,
  url: string,
  parameters: readonly OAuthParameter[],
): string {
  const parsed = new URL(url);
  const baseUri = `${parsed.protocol}//${parsed.host}${parsed.pathname}`;
  const encoded = [...parsed.searchParams.entries(), ...parameters].map(
    ([name, value]) => [percentEncode(name), percentEncode(value)] as const,
  );
  const normalized = stableSorted(encoded, ([nameA, valueA], [nameB, valueB]) => {
    if (nameA !== nameB) return nameA < nameB ? -1 : 1;
    if (valueA === valueB) return 0;
    return valueA < valueB ? -1 : 1;
  })
    .map(([name, value]) => `${name}=${value}`)
    .join('&');
  return [method.toUpperCase(), percentEncode(baseUri), percentEncode(normalized)].join('&');
}

/** HMAC-SHA1 of the base string, keyed `consumerSecret&tokenSecret` (both encoded), in base64. */
export function hmacSha1Signature(
  baseString: string,
  consumerSecret: string,
  tokenSecret = '',
): string {
  const key = `${percentEncode(consumerSecret)}&${percentEncode(tokenSecret)}`;
  return createHmac('sha1', key).update(baseString).digest('base64');
}

/**
 * The `Authorization` header for one request. `parameters` are the form-body (and any extra)
 * parameters the request will carry — they are part of what is signed, so the body sent must be
 * exactly these.
 */
export function signRequest(
  method: string,
  url: string,
  parameters: readonly OAuthParameter[],
  credentials: OAuthCredentials,
  { nonce, timestamp }: OAuthNonceAndTimestamp = {},
): string {
  const oauth: OAuthParameter[] = [
    ['oauth_consumer_key', credentials.consumerKey],
    ['oauth_nonce', nonce ?? randomBytes(16).toString('hex')],
    ['oauth_signature_method', 'HMAC-SHA1'],
    ['oauth_timestamp', String(timestamp ?? Math.floor(Date.now() / 1000))],
    ...(credentials.token === undefined ? [] : [['oauth_token', credentials.token] as const]),
    ['oauth_version', '1.0'],
  ];
  const signature = hmacSha1Signature(
    signatureBaseString(method, url, [...oauth, ...parameters]),
    credentials.consumerSecret,
    credentials.tokenSecret,
  );
  const signed: OAuthParameter[] = [...oauth, ['oauth_signature', signature]];
  const fields = stableSorted(signed, ([a], [b]) => (a < b ? -1 : 1)).map(
    ([name, value]) => `${percentEncode(name)}="${percentEncode(value)}"`,
  );
  return `OAuth ${fields.join(', ')}`;
}
